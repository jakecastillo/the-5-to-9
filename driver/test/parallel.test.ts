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

test('merge runs before bd close (commits land on base before bead is closed)', async () => {
  await withTick(async (dir) => {
    const order: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('bd ready'))
        return {
          stdout: JSON.stringify([{ id: 'a', status: 'open', inScopeDirs: ['src/a'] }]),
          stderr: '',
          code: 0,
        };
      if (key.startsWith('git merge-tree')) return { stdout: 'treeoid', stderr: '', code: 0 };
      if (key.startsWith('git checkout') || key.startsWith('git merge')) {
        order.push('merge');
        return { stdout: '', stderr: '', code: 0 };
      }
      if (key.startsWith('bd close')) {
        order.push('close');
        return { stdout: '{}', stderr: '', code: 0 };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };
    await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: new MockAdapter({ a: out('a', 'dealer') }),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 1,
      baseBranch: 'main',
    });
    const mergeIdx = order.indexOf('merge');
    const closeIdx = order.indexOf('close');
    assert.ok(mergeIdx !== -1, 'merge must run');
    assert.ok(closeIdx !== -1, 'close must run');
    assert.ok(mergeIdx < closeIdx, 'merge must precede bd close');
  });
});

test('worktree leak: a throwing worker still removes every created worktree (no orphans)', async () => {
  await withTick(async (dir) => {
    const removeCalls: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('bd ready'))
        return { stdout: JSON.stringify(readyAB), stderr: '', code: 0 };
      if (key.startsWith('git worktree add')) return { stdout: '', stderr: '', code: 0 };
      if (key.startsWith('git worktree remove')) {
        removeCalls.push(key);
        return { stdout: '', stderr: '', code: 0 };
      }
      if (key.startsWith('git merge-tree')) return { stdout: 'treeoid', stderr: '', code: 0 };
      return { stdout: '{}', stderr: '', code: 0 };
    };
    // Dealer throws for bead 'b' — simulates a crash mid Phase-1
    const throwingDealer = new MockAdapter({
      a: out('a', 'dealer'),
      // 'b' is intentionally absent so MockAdapter throws
    });
    // runParallelTick should NOT propagate the throw (settles gracefully)
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: throwingDealer,
      auditor: new MockAdapter({ a: out('a', 'auditor'), b: out('b', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
    });
    // Bead 'a' succeeds, 'b' fails
    assert.deepEqual(r.closedIds, ['a']);
    // Both worktrees must have been removed (no orphans)
    assert.equal(
      removeCalls.length,
      2,
      `expected 2 remove calls, got: ${JSON.stringify(removeCalls)}`,
    );
  });
});

test('WAL ordering (parallel): journal merge entry is written BEFORE worktrees.merge() executes', async () => {
  await withTick(async (dir) => {
    const eventOrder: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('bd ready'))
        return {
          stdout: JSON.stringify([{ id: 'a', status: 'open', inScopeDirs: ['src/a'] }]),
          stderr: '',
          code: 0,
        };
      if (key.startsWith('git merge-tree')) return { stdout: 'treeoid', stderr: '', code: 0 };
      if (key.startsWith('git checkout') || key.startsWith('git merge ')) {
        eventOrder.push('worktrees.merge');
        return { stdout: '', stderr: '', code: 0 };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };
    // Intercept journal.append to track when merge entry is written
    const journalPath = join(dir, 'journal-wal.jsonl');
    const realJournal = new Journal(journalPath);
    const proxyJournal = new Proxy(realJournal, {
      get(target, prop) {
        if (prop === 'append') {
          return async (e: { type: string; beadId?: string }) => {
            if (e.type === 'merge') eventOrder.push('journal.merge');
            return target.append(e as Parameters<typeof target.append>[0]);
          };
        }
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      },
    });

    await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: proxyJournal as Journal,
      log: new RunLog(join(dir, 'events-wal.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: new MockAdapter({ a: out('a', 'dealer') }),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 1,
      baseBranch: 'main',
    });

    const journalIdx = eventOrder.indexOf('journal.merge');
    const mergeIdx = eventOrder.indexOf('worktrees.merge');
    assert.ok(journalIdx !== -1, 'journal merge entry must be written');
    assert.ok(mergeIdx !== -1, 'worktrees.merge must run');
    assert.ok(
      journalIdx < mergeIdx,
      `journal.merge (${journalIdx}) must precede worktrees.merge (${mergeIdx}); order: ${JSON.stringify(eventOrder)}`,
    );
  });
});

test('merge journal entry prevents double-merge on replay (idempotency)', async () => {
  await withTick(async (dir) => {
    const mergeCalls: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('bd ready'))
        return {
          stdout: JSON.stringify([{ id: 'a', status: 'open', inScopeDirs: ['src/a'] }]),
          stderr: '',
          code: 0,
        };
      if (key.startsWith('git merge-tree')) return { stdout: 'treeoid', stderr: '', code: 0 };
      if (key.startsWith('git checkout') || key.startsWith('git merge')) {
        mergeCalls.push(key);
        return { stdout: '', stderr: '', code: 0 };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };
    // Pre-seed journal with a 'merge' entry for bead 'a'
    const journalPath = join(dir, 'journal.jsonl');
    const preJournal = new Journal(journalPath);
    await preJournal.append({ type: 'merge', beadId: 'a' });

    await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(journalPath, await Journal.replay(journalPath)),
      log: new RunLog(join(dir, 'events2.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: new MockAdapter({ a: out('a', 'dealer') }),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 1,
      baseBranch: 'main',
    });
    assert.equal(
      mergeCalls.filter((c) => c.startsWith('git merge')).length,
      0,
      'must not re-merge when journal has merge entry',
    );
  });
});
