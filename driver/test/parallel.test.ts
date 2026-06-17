import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MockAdapter } from '../src/adapters/mock.ts';
import { Beads } from '../src/beads.ts';
import type { ConsentRequest, PendingConsent, Resolution } from '../src/consent.ts';
import type { ExecFn, ExecResult } from '../src/exec.ts';
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

// ── Bead 128: the consent gate fires in the parallel (K>=2) tick ──────────────
//
// The gate must fire in runParallelTick IDENTICALLY to the K=1 path: a surfaced +
// FLAGGED outward action requests consent and, ONLY on a type-to-confirm APPROVE,
// execs the BYTE-EXACT command in THAT bead's worktree. Default-deny on
// deny/timeout/throw; an indeterminate resume leaves the bead OPEN. The SAME shared
// runGate (gate-consent.ts) is reused — no duplicated consent logic. All exec is
// MOCKED, the clock injected: no real commands, no real sleeping. Same assertions
// as the K=1 gate tests.

const OUTWARD = 'gh release create v1';

/** A dealer that surfaces a (flagged) outward action for the given bead id. */
function parallelDealerWithAction(id: string, action: string): MockAdapter {
  return new MockAdapter({
    [id]: {
      beadId: id,
      role: 'dealer',
      status: 'done',
      summary: 'surfaced an outward action',
      filesTouched: ['src/a.ts'],
      costUsd: 0.01,
      requestedAction: action,
    },
  });
}

/**
 * A perform-exec recorder for the parallel tick. It answers the bd/git protocol the
 * tick needs (bd ready/close, git worktree add/remove, git merge-tree/merge/checkout)
 * and records every OTHER exec — the perform calls — verbatim.
 */
function parallelRecordingExec(ready: Bead[]): { fn: ExecFn; performed: string[][] } {
  const performed: string[][] = [];
  const fn: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const key = [cmd, ...args].join(' ');
    if (key.startsWith('bd ready')) return { stdout: JSON.stringify(ready), stderr: '', code: 0 };
    if (key.startsWith('git merge-tree')) return { stdout: 'treeoid', stderr: '', code: 0 };
    if (cmd === 'bd' || cmd === 'git') return { stdout: '{}', stderr: '', code: 0 };
    // Anything else is a PERFORM call — record it verbatim.
    performed.push([cmd, ...args]);
    return { stdout: '', stderr: '', code: 0 };
  };
  return { fn, performed };
}

/** A consent stub recording requests and returning a scripted resolution. */
function consentStub(resolution: Resolution | (() => Promise<Resolution>)) {
  const requests: ConsentRequest[] = [];
  const requestConsent = (req: ConsentRequest): PendingConsent => {
    requests.push(req);
    return {
      id: 'consent-id-1',
      command: req.command,
      category: req.category,
      beadId: req.beadId ?? null,
      role: req.role ?? null,
      token: req.token && req.token.length > 0 ? req.token : 'gh',
      createdAt: '2026-06-17T00:00:00Z',
    };
  };
  const awaitResolution = async (_id: string): Promise<Resolution> =>
    typeof resolution === 'function' ? resolution() : resolution;
  return { requestConsent, awaitResolution, requests };
}

const readyA: Bead[] = [{ id: 'a', status: 'open', inScopeDirs: ['src/a'] }];

test('parallel gate APPROVE → execs the EXACT command (in the bead worktree), bead closes', async () => {
  await withTick(async (dir) => {
    const { fn, performed } = parallelRecordingExec(readyA);
    const journal = new Journal(join(dir, 'journal.jsonl'));
    const stub = consentStub({
      id: 'consent-id-1',
      approved: true,
      token: 'gh',
      resolvedAt: '2026-06-17T00:00:01Z',
    });
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: parallelDealerWithAction('a', OUTWARD),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: stub.requestConsent,
      awaitResolution: stub.awaitResolution,
      exec: fn,
      stateDir: dir,
    });
    // (1) exact-command integrity: exactly one perform, byte-identical, in the bead worktree.
    assert.equal(performed.length, 1, 'exactly one perform');
    assert.deepEqual(performed[0], ['bash', '-c', OUTWARD]);
    assert.equal(stub.requests[0]?.command, OUTWARD, 'consent requested for the exact action');
    // gate + performed marker journaled; the bead closes.
    assert.equal(journal.hasDone('gate', 'a'), true);
    assert.equal(journal.hasDone('gate-performed', 'a'), true);
    assert.deepEqual(r.closedIds, ['a']);
  });
});

test('parallel gate DENY → exec NEVER called, bead NOT closed (stays open)', async () => {
  await withTick(async (dir) => {
    const { fn, performed } = parallelRecordingExec(readyA);
    const journal = new Journal(join(dir, 'journal.jsonl'));
    const stub = consentStub({
      id: 'consent-id-1',
      approved: false,
      token: null,
      resolvedAt: '2026-06-17T00:00:01Z',
    });
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: parallelDealerWithAction('a', OUTWARD),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: stub.requestConsent,
      awaitResolution: stub.awaitResolution,
      exec: fn,
      stateDir: dir,
    });
    // (2) default-deny: nothing performed, bead NOT closed.
    assert.equal(performed.length, 0, 'a deny must perform NOTHING');
    assert.deepEqual(r.closedIds, [], 'a denied bead is not closed');
    assert.equal(journal.hasDone('gate', 'a'), true);
    assert.equal(journal.hasDone('gate-performed', 'a'), false);
  });
});

test('parallel gate TIMEOUT (real awaitResolution + injected clock) → exec NEVER called, not closed', async () => {
  await withTick(async (dir) => {
    const { fn, performed } = parallelRecordingExec(readyA);
    // Injected clock jumps past the timeout so the REAL awaitResolution returns a DENY.
    let t = 0;
    const now = () => {
      const v = t;
      t += 10_000;
      return v;
    };
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: parallelDealerWithAction('a', OUTWARD),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      // default (real) requestConsent/awaitResolution bound to stateDir + clock.
      exec: fn,
      stateDir: dir,
      now,
      consentTimeoutMs: 100,
      consentPollMs: 1,
    });
    // INVARIANT: timeout → DENY, never silent-allow.
    assert.equal(performed.length, 0, 'a timeout must perform NOTHING');
    assert.deepEqual(r.closedIds, []);
  });
});

test('parallel gate consent THROWS → exec NEVER called, treated as DENY (not closed)', async () => {
  await withTick(async (dir) => {
    const { fn, performed } = parallelRecordingExec(readyA);
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: parallelDealerWithAction('a', OUTWARD),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: () => {
        throw new Error('consent backend exploded');
      },
      awaitResolution: async () => {
        throw new Error('should not reach');
      },
      exec: fn,
      stateDir: dir,
    });
    // INVARIANT: any throw in the consent/perform path → DENY (no exec).
    assert.equal(performed.length, 0, 'a thrown consent error must perform NOTHING');
    assert.deepEqual(r.closedIds, []);
  });
});

test('parallel gate resume: an indeterminate (approve journaled, no performed-marker) bead is NOT closed and NOT re-exec`d', async () => {
  await withTick(async (dir) => {
    const path = join(dir, 'journal.jsonl');
    // Simulate the crash window: APPROVE journaled, but the perform never produced its marker.
    const pre = new Journal(path);
    await pre.append({ type: 'gate', beadId: 'a', approved: true });
    const { fn, performed } = parallelRecordingExec(readyA);
    let consentConsulted = false;
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(path, await Journal.replay(path)),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: parallelDealerWithAction('a', OUTWARD),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: () => {
        consentConsulted = true;
        throw new Error('must not re-request consent for an indeterminate action');
      },
      awaitResolution: async () => {
        consentConsulted = true;
        throw new Error('must not await on resume');
      },
      exec: fn,
      stateDir: dir,
    });
    // bead-closed != action-done: not closed, NOT re-exec'd, consent NOT re-asked.
    assert.equal(performed.length, 0, 'an indeterminate action is NEVER re-exec`d');
    assert.equal(consentConsulted, false, 'indeterminate does not blindly re-ask consent');
    assert.deepEqual(r.closedIds, [], 'an indeterminate bead does NOT close');
  });
});

test('parallel: a benign (non-flagged) surfaced action → no consent, no perform, bead closes', async () => {
  await withTick(async (dir) => {
    const { fn, performed } = parallelRecordingExec(readyA);
    let consentConsulted = false;
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer: parallelDealerWithAction('a', 'npm test'),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
      classify: () => ({ denied: false, segment: null }),
      requestConsent: () => {
        consentConsulted = true;
        throw new Error('benign action must not request consent');
      },
      awaitResolution: async () => {
        throw new Error('benign action must not await');
      },
      exec: fn,
      stateDir: dir,
    });
    assert.equal(consentConsulted, false, 'a benign action requests no consent');
    assert.equal(performed.length, 0, 'a benign action performs nothing via the gate');
    assert.deepEqual(r.closedIds, ['a']);
  });
});

test('parallel: an absent requestedAction → classifier not consulted, no perform, bead closes', async () => {
  await withTick(async (dir) => {
    const { fn, performed } = parallelRecordingExec(readyA);
    let classifyConsulted = false;
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      // out('a','dealer') has NO requestedAction.
      dealer: new MockAdapter({ a: out('a', 'dealer') }),
      auditor: new MockAdapter({ a: out('a', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
      classify: () => {
        classifyConsulted = true;
        return { denied: true, segment: 'x' };
      },
      exec: fn,
      stateDir: dir,
    });
    assert.equal(classifyConsulted, false, 'no requestedAction → classifier not consulted');
    assert.equal(performed.length, 0);
    assert.deepEqual(r.closedIds, ['a']);
  });
});

test('parallel gate is PER-BEAD: a denied bead stays open while an independent benign bead closes', async () => {
  await withTick(async (dir) => {
    const readyAB2: Bead[] = [
      { id: 'a', status: 'open', inScopeDirs: ['src/a'] },
      { id: 'b', status: 'open', inScopeDirs: ['src/b'] },
    ];
    const { fn, performed } = parallelRecordingExec(readyAB2);
    // 'a' surfaces a flagged outward action (will be DENIED); 'b' surfaces nothing.
    const dealer = new MockAdapter({
      a: {
        beadId: 'a',
        role: 'dealer',
        status: 'done',
        summary: 'surfaced',
        filesTouched: ['src/a/x.ts'],
        costUsd: 0.01,
        requestedAction: OUTWARD,
      },
      b: out('b', 'dealer'),
    });
    const r = await runParallelTick({
      beads: new Beads(fn, new WriteQueue()),
      worktrees: new Worktrees(fn, dir),
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(10, 0),
      dealer,
      auditor: new MockAdapter({ a: out('a', 'auditor'), b: out('b', 'auditor') }),
      mechanicalGate: async () => ({ green: true }),
      k: 2,
      baseBranch: 'main',
      // only the action surfaced by 'a' is flagged; 'b' surfaces nothing so classify is moot.
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: (req: ConsentRequest) => ({
        id: 'consent-id-1',
        command: req.command,
        category: req.category,
        beadId: req.beadId ?? null,
        role: req.role ?? null,
        token: 'gh',
        createdAt: '2026-06-17T00:00:00Z',
      }),
      awaitResolution: async (): Promise<Resolution> => ({
        id: 'consent-id-1',
        approved: false,
        token: null,
        resolvedAt: '2026-06-17T00:00:01Z',
      }),
      exec: fn,
      stateDir: dir,
    });
    assert.equal(performed.length, 0, 'the denied action performed nothing');
    assert.deepEqual(r.closedIds, ['b'], "only the independent benign bead 'b' closes");
  });
});
