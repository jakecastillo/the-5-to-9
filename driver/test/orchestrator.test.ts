import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MockAdapter } from '../src/adapters/mock.ts';
import { Beads } from '../src/beads.ts';
import type { ExecFn } from '../src/exec.ts';
import { Journal } from '../src/journal.ts';
import { BudgetLedger, RunLog } from '../src/observability.ts';
import { runSingleBeadTick } from '../src/orchestrator.ts';
import { WriteQueue } from '../src/write-queue.ts';

function fakeBdExec(): { fn: ExecFn; calls: string[] } {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    if (key.startsWith('bd ready')) {
      return {
        stdout: JSON.stringify([{ id: 'b1', status: 'open', inScopeDirs: ['src'] }]),
        stderr: '',
        code: 0,
      };
    }
    return { stdout: '{}', stderr: '', code: 0 };
  };
  return { fn, calls };
}

const dealerScript = {
  b1: {
    beadId: 'b1',
    role: 'dealer' as const,
    status: 'done' as const,
    summary: 'impl',
    filesTouched: ['src/a.ts'],
    costUsd: 0.01,
  },
};
const auditorScript = {
  b1: {
    beadId: 'b1',
    role: 'auditor' as const,
    status: 'done' as const,
    summary: 'verified',
    filesTouched: [],
    costUsd: 0.005,
  },
};

test('closes the bead after Dealer + independent Auditor both pass', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-'));
  try {
    const { fn, calls } = fakeBdExec();
    const beads = new Beads(fn, new WriteQueue());
    const r = await runSingleBeadTick({
      beads,
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: new MockAdapter(dealerScript),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
    });
    assert.equal(r.closed, 'b1');
    assert.ok(calls.some((c) => c.startsWith('bd update b1 --claim')));
    assert.ok(calls.some((c) => c.startsWith('bd close b1')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does NOT close on a red mechanical gate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-'));
  try {
    const { fn, calls } = fakeBdExec();
    const beads = new Beads(fn, new WriteQueue());
    const r = await runSingleBeadTick({
      beads,
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: new MockAdapter(dealerScript),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: false }),
      worktreeRoot: dir,
    });
    assert.equal(r.closed, null);
    assert.equal(r.reason, 'mechanical-gate-red');
    assert.equal(calls.filter((c) => c.startsWith('bd close b1')).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resume is idempotent: an already-closed bead is not re-closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-'));
  try {
    const path = join(dir, 'journal.jsonl');
    const pre = new Journal(path);
    await pre.append({ type: 'close', beadId: 'b1' }); // simulate a prior crash after close
    const { fn, calls } = fakeBdExec();
    const beads = new Beads(fn, new WriteQueue());
    const r = await runSingleBeadTick({
      beads,
      journal: new Journal(path, await Journal.replay(path)),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: new MockAdapter(dealerScript),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
    });
    assert.equal(r.skipped, 'b1');
    assert.equal(calls.filter((c) => c.startsWith('bd close b1')).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
