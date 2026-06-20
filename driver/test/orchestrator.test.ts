import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MockAdapter } from '../src/adapters/mock.ts';
import { Beads } from '../src/beads.ts';
import type { ConsentRequest, PendingConsent, Resolution } from '../src/consent.ts';
import type { ExecFn, ExecResult } from '../src/exec.ts';
import { Journal } from '../src/journal.ts';
import { BudgetLedger, RunLog } from '../src/observability.ts';
import { runSingleBeadTick } from '../src/orchestrator.ts';
import { Worktrees } from '../src/worktree.ts';
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
    // Faithful to real git: `git worktree add -b <branch> <path> HEAD` creates <path>.
    if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
      await mkdir(args[args.length - 2], { recursive: true });
    }
    return { stdout: '{}', stderr: '', code: 0 };
  };
  return { fn, calls };
}

function makeWorktrees(fn: ExecFn, dir: string): Worktrees {
  return new Worktrees(fn, dir);
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
      worktrees: makeWorktrees(fn, dir),
      baseBranch: 'main',
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
      worktrees: makeWorktrees(fn, dir),
      baseBranch: 'main',
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
      worktrees: makeWorktrees(fn, dir),
      baseBranch: 'main',
    });
    assert.equal(r.skipped, 'b1');
    assert.equal(calls.filter((c) => c.startsWith('bd close b1')).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('single-bead tick: merge runs before bd close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-'));
  try {
    const order: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('bd ready'))
        return {
          stdout: JSON.stringify([{ id: 'b1', status: 'open', inScopeDirs: ['src'] }]),
          stderr: '',
          code: 0,
        };
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
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
    });
    assert.equal(r.closed, 'b1');
    const mergeIdx = order.indexOf('merge');
    const closeIdx = order.indexOf('close');
    assert.ok(mergeIdx !== -1, 'merge must run');
    assert.ok(closeIdx !== -1, 'close must run');
    assert.ok(mergeIdx < closeIdx, 'merge must precede bd close');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('WAL ordering (orchestrator): journal merge entry is written BEFORE worktrees.merge() executes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-'));
  try {
    const eventOrder: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('bd ready'))
        return {
          stdout: JSON.stringify([{ id: 'b1', status: 'open', inScopeDirs: ['src'] }]),
          stderr: '',
          code: 0,
        };
      if (key.startsWith('git checkout') || key.startsWith('git merge ')) {
        eventOrder.push('worktrees.merge');
        return { stdout: '', stderr: '', code: 0 };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };
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

    const beads = new Beads(fn, new WriteQueue());
    await runSingleBeadTick({
      beads,
      journal: proxyJournal as Journal,
      log: new RunLog(join(dir, 'events-wal.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: new MockAdapter(dealerScript),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Phase 1c: the consent gate + perform-on-approve ──────────────────────────
//
// All exec is MOCKED and the clock is injected — no real commands, no real
// sleeping. We assert the four security invariants directly:
//   (1) exact-command integrity   — exec gets the BYTE-IDENTICAL approved command.
//   (2) default-deny              — deny/timeout/throw → exec is NEVER called.
//   (3) mandatory-consent         — no perform without a passed checkpoint.
//   (4) idempotent-resume         — hasDone('gate') guards re-perform.

const OUTWARD = 'gh release create v1';

/** A dealer that surfaces a (flagged) outward action. */
function dealerWithAction(action: string) {
  return new MockAdapter({
    b1: {
      beadId: 'b1',
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
 * A perform-exec recorder that ALSO answers the bd reads the tick needs. The
 * perform command is `bash -c <command>`; the bd protocol uses `bd ...`. We
 * record every non-bd, non-git exec call so the test can assert exactly what
 * (if anything) was performed.
 */
function recordingExec(): { fn: ExecFn; performed: string[][] } {
  const performed: string[][] = [];
  const fn: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const key = [cmd, ...args].join(' ');
    if (key.startsWith('bd ready')) {
      return {
        stdout: JSON.stringify([{ id: 'b1', status: 'open', inScopeDirs: ['src'] }]),
        stderr: '',
        code: 0,
      };
    }
    if (cmd === 'bd' || cmd === 'git') return { stdout: '{}', stderr: '', code: 0 };
    // Anything else is a PERFORM call — record it verbatim.
    performed.push([cmd, ...args]);
    return { stdout: '', stderr: '', code: 0 };
  };
  return { fn, performed };
}

/** A consent stub that records what was requested and returns a scripted resolution. */
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

test('gate APPROVE → execs the EXACT approved command, journals gate(approved), proceeds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(join(dir, 'journal.jsonl'));
    const stub = consentStub({
      id: 'consent-id-1',
      approved: true,
      token: 'gh',
      resolvedAt: '2026-06-17T00:00:01Z',
    });
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
      // gate wiring (Phase 1c):
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: stub.requestConsent,
      awaitResolution: stub.awaitResolution,
      exec: fn,
      stateDir: dir,
    });
    // (1) exact-command integrity: the performed command is byte-identical.
    assert.equal(performed.length, 1, 'exactly one perform');
    assert.deepEqual(performed[0], ['bash', '-c', OUTWARD]);
    // the command requested for consent is also the exact surfaced action.
    assert.equal(stub.requests[0]?.command, OUTWARD);
    // a 'gate' event was journaled (approved) and the bead proceeds to close.
    assert.equal(journal.hasDone('gate', 'b1'), true);
    // bead 5va: a distinct 'gate-performed' marker is journaled AFTER a successful exec,
    // so a later resume knows the action ran exactly once (vs. the indeterminate window).
    assert.equal(journal.hasDone('gate-performed', 'b1'), true);
    assert.equal(r.closed, 'b1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate DENY → exec is NEVER called, bead stays blocked (closed:null), gate journaled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(join(dir, 'journal.jsonl'));
    const stub = consentStub({
      id: 'consent-id-1',
      approved: false,
      token: null,
      resolvedAt: '2026-06-17T00:00:01Z',
    });
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: stub.requestConsent,
      awaitResolution: stub.awaitResolution,
      exec: fn,
      stateDir: dir,
    });
    // (2) default-deny: nothing performed, bead NOT closed.
    assert.equal(performed.length, 0, 'a deny must perform NOTHING');
    assert.equal(r.closed, null);
    assert.equal(r.reason, 'gate-denied');
    assert.equal(journal.hasDone('gate', 'b1'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate TIMEOUT (real awaitResolution + injected clock) → exec NEVER called, gate-denied', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(join(dir, 'journal.jsonl'));
    // Injected clock jumps past the timeout so the REAL awaitResolution returns
    // a DENY with no real timer.
    let t = 0;
    const now = () => {
      const v = t;
      t += 10_000;
      return v;
    };
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      // use the DEFAULT consent (real requestConsent/awaitResolution) bound to stateDir+clock.
      exec: fn,
      stateDir: dir,
      now,
      consentTimeoutMs: 100,
      consentPollMs: 1,
    });
    // INVARIANT: timeout → DENY, never silent-allow.
    assert.equal(performed.length, 0, 'a timeout must perform NOTHING');
    assert.equal(r.closed, null);
    assert.equal(r.reason, 'gate-denied');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate consent THROWS → exec NEVER called, treated as DENY (gate-denied)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(join(dir, 'journal.jsonl'));
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
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
    assert.equal(r.closed, null);
    assert.equal(r.reason, 'gate-denied');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate resume: approve + gate-performed marker → NOT re-performed, bead closes (done)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const path = join(dir, 'journal.jsonl');
    // Simulate a prior crash AFTER the action was approved AND successfully performed:
    // BOTH the approved 'gate' AND the distinct 'gate-performed' marker are journaled.
    const pre = new Journal(path);
    await pre.append({ type: 'gate', beadId: 'b1', approved: true });
    await pre.append({ type: 'gate-performed', beadId: 'b1', command: OUTWARD });
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(path, await Journal.replay(path));
    // A consent stub that would APPROVE — it must NOT be consulted on resume.
    let consentConsulted = false;
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: () => {
        consentConsulted = true;
        throw new Error('must not request consent on resume');
      },
      awaitResolution: async () => {
        consentConsulted = true;
        throw new Error('must not await on resume');
      },
      exec: fn,
      stateDir: dir,
    });
    // (4) idempotent-resume: a PERFORMED action is not re-run, not re-consulted; bead closes.
    assert.equal(performed.length, 0, 'an already-performed action is not re-run');
    assert.equal(consentConsulted, false, 'consent is not re-requested on resume');
    assert.equal(r.closed, 'b1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Bead 5va: close the journaled-approve-but-not-exec'd window ───────────────
//
// The defect: runGate journaled an APPROVED 'gate' BEFORE exec and guarded resume
// with hasDone('gate'). A crash BETWEEN the approve-journal and a successful exec
// meant resume saw hasDone('gate')===true, SKIPPED the gate, and the bead could
// CLOSE as done WITHOUT the action ever running. The fix journals a DISTINCT
// 'gate-performed' marker AFTER a successful exec; resume keys on that marker.
//
// INVARIANT: bead-closed implies action-performed (or surfaced) — never silently
// skipped-and-closed; and NEVER double-perform an irreversible action on resume.

test('5va resume: approve journaled but NO gate-performed → indeterminate, bead NOT closed, NO re-exec', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const path = join(dir, 'journal.jsonl');
    // Simulate the crash window: the APPROVE was journaled but the exec never
    // produced its 'gate-performed' marker (it may have partially run).
    const pre = new Journal(path);
    await pre.append({ type: 'gate', beadId: 'b1', approved: true });
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(path, await Journal.replay(path));
    let consentConsulted = false;
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: () => {
        consentConsulted = true;
        throw new Error('must not re-request consent for an approved action');
      },
      awaitResolution: async () => {
        consentConsulted = true;
        throw new Error('must not await on resume');
      },
      exec: fn,
      stateDir: dir,
    });
    // bead-closed != action-done: the bead is NOT closed, NOTHING is re-exec'd, and
    // the consent is NOT re-asked (an irreversible op may have partially run).
    assert.equal(performed.length, 0, 'an indeterminate action is NEVER re-exec`d on resume');
    assert.equal(consentConsulted, false, 'indeterminate does not blindly re-ask consent');
    assert.equal(r.closed, null, 'a journaled-but-unperformed approve does NOT close the bead');
    assert.equal(r.reason, 'gate-indeterminate');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('5va: a crash AFTER approve-journal but BEFORE exec → next run does NOT close, does NOT double-exec', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const path = join(dir, 'journal.jsonl');
    // First run: approve resolves, but the perform exec THROWS — simulating a crash
    // mid-exec. runGate's catch returns 'denied'; crucially NO 'gate-performed' marker
    // is written, so the action's completion is INDETERMINATE.
    const performedRun1: string[][] = [];
    const fn1: ExecFn = async (cmd, args): Promise<ExecResult> => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('bd ready'))
        return {
          stdout: JSON.stringify([{ id: 'b1', status: 'open', inScopeDirs: ['src'] }]),
          stderr: '',
          code: 0,
        };
      if (cmd === 'bd' || cmd === 'git') return { stdout: '{}', stderr: '', code: 0 };
      // The PERFORM call: record it, then throw mid-flight (crash during the irreversible op).
      performedRun1.push([cmd, ...args]);
      throw new Error('crash during exec');
    };
    const journal1 = new Journal(path);
    const stubApprove = consentStub({
      id: 'consent-id-1',
      approved: true,
      token: 'gh',
      resolvedAt: '2026-06-17T00:00:01Z',
    });
    const r1 = await runSingleBeadTick({
      beads: new Beads(fn1, new WriteQueue()),
      journal: journal1,
      log: new RunLog(join(dir, 'events1.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn1, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: stubApprove.requestConsent,
      awaitResolution: stubApprove.awaitResolution,
      exec: fn1,
      stateDir: dir,
    });
    // The exec was attempted exactly once and the bead did NOT close (exec threw).
    assert.equal(performedRun1.length, 1, 'the perform was attempted once');
    assert.equal(r1.closed, null, 'a thrown exec must not close the bead');
    assert.equal(journal1.hasDone('gate', 'b1'), true, 'the approve WAS journaled');
    assert.equal(
      journal1.hasDone('gate-performed', 'b1'),
      false,
      'no performed-marker after a thrown exec',
    );

    // Second run (resume): replay the journal. The approve is present but NOT performed
    // → INDETERMINATE. The bead must NOT close and the action must NOT re-exec.
    const { fn: fn2, performed: performedRun2 } = recordingExec();
    const journal2 = new Journal(path, await Journal.replay(path));
    const r2 = await runSingleBeadTick({
      beads: new Beads(fn2, new WriteQueue()),
      journal: journal2,
      log: new RunLog(join(dir, 'events2.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn2, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: () => {
        throw new Error('must not re-request consent on resume');
      },
      awaitResolution: async () => {
        throw new Error('must not await on resume');
      },
      exec: fn2,
      stateDir: dir,
    });
    assert.equal(performedRun2.length, 0, 'the irreversible action is NEVER re-exec`d on resume');
    assert.equal(r2.closed, null, 'an indeterminate action does NOT close the bead');
    assert.equal(r2.reason, 'gate-indeterminate');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('5va: full approve+exec writes gate-performed; resume treats as done with NO re-exec', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const path = join(dir, 'journal.jsonl');
    // First run: approve resolves AND the exec succeeds → both 'gate' and
    // 'gate-performed' are journaled, the bead closes.
    const { fn: fn1, performed: performedRun1 } = recordingExec();
    const journal1 = new Journal(path);
    const stubApprove = consentStub({
      id: 'consent-id-1',
      approved: true,
      token: 'gh',
      resolvedAt: '2026-06-17T00:00:01Z',
    });
    const r1 = await runSingleBeadTick({
      beads: new Beads(fn1, new WriteQueue()),
      journal: journal1,
      log: new RunLog(join(dir, 'events1.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn1, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: stubApprove.requestConsent,
      awaitResolution: stubApprove.awaitResolution,
      exec: fn1,
      stateDir: dir,
    });
    assert.equal(performedRun1.length, 1, 'performed exactly once on the first run');
    assert.deepEqual(performedRun1[0], ['bash', '-c', OUTWARD]);
    assert.equal(r1.closed, 'b1');
    assert.equal(journal1.hasDone('gate-performed', 'b1'), true, 'performed-marker written');

    // Reset the close marker only is not needed — we resume with a FRESH journal replay
    // but BEFORE the close was applied to beads (simulate crash after gate-performed,
    // before close). We strip the 'close' line to model that window.
    const replayed = await Journal.replay(path);
    const withoutClose = replayed.filter((e) => e.type !== 'close');
    const journal2 = new Journal(join(dir, 'journal2.jsonl'), withoutClose);
    const { fn: fn2, performed: performedRun2 } = recordingExec();
    const r2 = await runSingleBeadTick({
      beads: new Beads(fn2, new WriteQueue()),
      journal: journal2,
      log: new RunLog(join(dir, 'events2.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn2, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: () => {
        throw new Error('must not re-request consent on resume');
      },
      awaitResolution: async () => {
        throw new Error('must not await on resume');
      },
      exec: fn2,
      stateDir: dir,
    });
    // The performed-marker present → treated as done, NO re-exec, the bead closes.
    assert.equal(performedRun2.length, 0, 'a performed action is NEVER re-exec`d on resume');
    assert.equal(r2.closed, 'b1', 'a performed-then-resumed bead closes as done');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('5va: a DENY resume stays a clean non-performed decision (gate-denied, never indeterminate)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const path = join(dir, 'journal.jsonl');
    // A denied 'gate' (approved:false) with no performed-marker is a CLEAN decision —
    // it must resume as 'gate-denied', not as the indeterminate window.
    const pre = new Journal(path);
    await pre.append({ type: 'gate', beadId: 'b1', approved: false });
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(path, await Journal.replay(path));
    let consentConsulted = false;
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction(OUTWARD),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
      classify: () => ({ denied: true, segment: OUTWARD }),
      requestConsent: () => {
        consentConsulted = true;
        throw new Error('must not re-request consent on a resumed deny');
      },
      awaitResolution: async () => {
        consentConsulted = true;
        throw new Error('must not await on resume');
      },
      exec: fn,
      stateDir: dir,
    });
    assert.equal(performed.length, 0, 'a denied action performs nothing on resume');
    assert.equal(consentConsulted, false, 'a denied action is not re-asked on resume');
    assert.equal(r.closed, null, 'a denied action does not close the bead');
    assert.equal(r.reason, 'gate-denied', 'a clean deny stays gate-denied, not indeterminate');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a benign (non-flagged) requestedAction → no consent, no perform, normal close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(join(dir, 'journal.jsonl'));
    let consentConsulted = false;
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: dealerWithAction('npm test'),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
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
    assert.equal(journal.hasDone('gate', 'b1'), false, 'no gate event for a benign action');
    assert.equal(r.closed, 'b1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an empty/absent requestedAction → no consent, no gate event, normal close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const { fn, performed } = recordingExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(join(dir, 'journal.jsonl'));
    let classifyConsulted = false;
    const r = await runSingleBeadTick({
      beads,
      journal,
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      // dealerScript has NO requestedAction.
      dealer: new MockAdapter(dealerScript),
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
      classify: () => {
        classifyConsulted = true;
        return { denied: true, segment: 'x' };
      },
      exec: fn,
      stateDir: dir,
    });
    assert.equal(classifyConsulted, false, 'no requestedAction → classifier not even consulted');
    assert.equal(performed.length, 0);
    assert.equal(journal.hasDone('gate', 'b1'), false);
    assert.equal(r.closed, 'b1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Bug fix: K=1 worktree directory not created before dealer runs (bead uts) ───
//
// orchestrator.ts constructs the K=1 worktree path as `${worktreeRoot}/wt-${bead.id}`
// but never creates the directory. The fix must either call worktrees.add() (preferred,
// so path construction matches K>=2 via Worktrees.pathFor) or mkdir the path.
// Either way the directory must exist before dealer.run is called.

test('K=1 tick: worktree directory exists before dealer runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-wt-'));
  try {
    const { fn } = fakeBdExec();
    let worktreePathSeen: string | null = null;
    // Intercept dealer.run to capture the worktree path it receives
    const capturingDealer = {
      async run(spec: { worktree: string }) {
        worktreePathSeen = spec.worktree;
        // At the moment dealer.run is called, the directory MUST already exist
        await access(spec.worktree); // throws ENOENT if absent
        return dealerScript.b1;
      },
    };
    const beads = new Beads(fn, new WriteQueue());
    const r = await runSingleBeadTick({
      beads,
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: capturingDealer as unknown as import('../src/adapters/mock.ts').MockAdapter,
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: makeWorktrees(fn, dir),
      baseBranch: 'main',
    });
    assert.ok(worktreePathSeen !== null, 'dealer.run must have been called');
    assert.equal(r.closed, 'b1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Bug fix (jnx.3): the K=1 tick must CREATE the branch it later merges ──────
//
// orchestrator.ts created a bare `mkdir` worktree, never a git worktree on the
// bead's branch. The Cage step then merged `shift/<bead.id>` — a branch that was
// never created, so isolation was broken and the merge had nothing real to take.
// The fix issues `git worktree add -b shift/<bead.id> <path> HEAD` (via
// Worktrees.add) BEFORE the dealer runs, on the SAME branch the merge references.

test('K=1 tick: creates the worktree branch (worktrees.add -b) before the dealer, merges that branch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-add-'));
  try {
    const order: string[] = [];
    let addArgs: string[] | null = null;
    const fn: ExecFn = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('bd ready'))
        return {
          stdout: JSON.stringify([{ id: 'b1', status: 'open', inScopeDirs: ['src'] }]),
          stderr: '',
          code: 0,
        };
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        order.push('worktree-add');
        addArgs = args;
        // Faithful to real git: `git worktree add ... <path> HEAD` creates <path>.
        await mkdir(args[args.length - 2], { recursive: true });
      }
      if (key.startsWith('git merge ')) order.push(`merge ${args[args.length - 1]}`);
      return { stdout: '{}', stderr: '', code: 0 };
    };
    const capturingDealer = {
      async run() {
        order.push('dealer');
        return dealerScript.b1;
      },
    };
    const beads = new Beads(fn, new WriteQueue());
    const r = await runSingleBeadTick({
      beads,
      journal: new Journal(join(dir, 'journal.jsonl')),
      log: new RunLog(join(dir, 'events.jsonl')),
      ledger: new BudgetLedger(1, 0),
      dealer: capturingDealer as unknown as import('../src/adapters/mock.ts').MockAdapter,
      auditor: new MockAdapter(auditorScript),
      mechanicalGate: async () => ({ green: true }),
      worktreeRoot: dir,
      worktrees: new Worktrees(fn, dir),
      baseBranch: 'main',
    });
    assert.equal(r.closed, 'b1');
    const addIdx = order.indexOf('worktree-add');
    const dealerIdx = order.indexOf('dealer');
    assert.ok(addIdx !== -1, `a git worktree add must be issued; order=${JSON.stringify(order)}`);
    assert.ok(addIdx < dealerIdx, 'the worktree branch must be created before the dealer runs');
    // the add creates the bead's branch via -b shift/b1
    assert.deepEqual(
      [addArgs?.[2], addArgs?.[3]],
      ['-b', 'shift/b1'],
      `worktree add must create -b shift/b1; got ${JSON.stringify(addArgs)}`,
    );
    // the merge references that SAME created branch
    assert.ok(
      order.includes('merge shift/b1'),
      `the merge must reference shift/b1; order=${JSON.stringify(order)}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
