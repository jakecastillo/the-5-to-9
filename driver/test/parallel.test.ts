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
import { type ParallelTickDeps, runParallelTick } from '../src/parallel.ts';
import type { Bead, WorkerOutcome } from '../src/types.ts';
import { Worktrees } from '../src/worktree.ts';
import { WriteQueue } from '../src/write-queue.ts';

const out = (id: string, role: 'dealer' | 'auditor'): WorkerOutcome => ({
  beadId: id,
  role,
  status: 'done',
  summary: 's',
  filesTouched: [],
  costUsd: 0.01,
});

function fakeExec(ready: Bead[], conflictBranches: string[] = []): { fn: ExecFn; calls: string[] } {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    if (key.startsWith('bd ready')) return { stdout: JSON.stringify(ready), stderr: '', code: 0 };
    if (key.startsWith('git merge-tree')) {
      const branch = args[args.length - 1];
      if (conflictBranches.includes(branch)) throw new Error('conflict');
      return { stdout: 'treeoid', stderr: '', code: 0 };
    }
    return { stdout: '{}', stderr: '', code: 0 };
  };
  return { fn, calls };
}

async function withTick(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'f9par-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const readyAB: Bead[] = [
  { id: 'a', status: 'open', inScopeDirs: ['src/a'] },
  { id: 'b', status: 'open', inScopeDirs: ['src/b'] },
];

function deps(
  dir: string,
  fn: ExecFn,
  gate: (wt: string) => Promise<{ green: boolean }>,
): ParallelTickDeps {
  return {
    beads: new Beads(fn, new WriteQueue()),
    worktrees: new Worktrees(fn, dir),
    journal: new Journal(join(dir, 'journal.jsonl')),
    log: new RunLog(join(dir, 'events.jsonl')),
    ledger: new BudgetLedger(10, 0),
    dealer: new MockAdapter({ a: out('a', 'dealer'), b: out('b', 'dealer') }),
    auditor: new MockAdapter({ a: out('a', 'auditor'), b: out('b', 'auditor') }),
    mechanicalGate: gate,
    k: 2,
    baseBranch: 'main',
  };
}

test('two write-independent beads both close (K=2), worktrees cleaned up', async () => {
  await withTick(async (dir) => {
    const { fn, calls } = fakeExec(readyAB);
    const r = await runParallelTick(deps(dir, fn, async () => ({ green: true })));
    assert.deepEqual(r.closedIds.sort(), ['a', 'b']);
    assert.ok(calls.some((c) => c.startsWith('bd close a')));
    assert.ok(calls.some((c) => c.startsWith('bd close b')));
    assert.equal(calls.filter((c) => c.startsWith('git worktree remove')).length, 2);
  });
});

test('the merge-tree backstop re-queues a colliding bead (not closed)', async () => {
  await withTick(async (dir) => {
    const { fn, calls } = fakeExec(readyAB, ['shift/b']);
    const r = await runParallelTick(deps(dir, fn, async () => ({ green: true })));
    assert.deepEqual(r.closedIds, ['a']);
    assert.equal(calls.filter((c) => c.startsWith('bd close b')).length, 0);
  });
});

test('a red mechanical gate rejects that bead while others close', async () => {
  await withTick(async (dir) => {
    const { fn } = fakeExec(readyAB);
    const r = await runParallelTick(deps(dir, fn, async (wt) => ({ green: !wt.includes('wt-b') })));
    assert.deepEqual(r.closedIds, ['a']);
  });
});

test('an empty queue reports empty', async () => {
  await withTick(async (dir) => {
    const { fn } = fakeExec([]);
    const r = await runParallelTick(deps(dir, fn, async () => ({ green: true })));
    assert.equal(r.empty, true);
    assert.deepEqual(r.closedIds, []);
  });
});
