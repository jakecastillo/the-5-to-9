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

test('gate resume: hasDone(gate) → the approved action is NOT re-performed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9gate-'));
  try {
    const path = join(dir, 'journal.jsonl');
    // Simulate a prior crash AFTER the gate decision was journaled.
    const pre = new Journal(path);
    await pre.append({ type: 'gate', beadId: 'b1', approved: true });
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
    // (4) idempotent-resume: no re-perform, no re-consult; the bead proceeds.
    assert.equal(performed.length, 0, 'an already-performed action is not re-run');
    assert.equal(consentConsulted, false, 'consent is not re-requested on resume');
    assert.equal(r.closed, 'b1');
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
