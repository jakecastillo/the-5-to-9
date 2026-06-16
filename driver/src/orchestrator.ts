import { BD_WRITE_DENY, IRREVERSIBLE_DENY, type WorkerAdapter } from './adapters/adapter.ts';
import type { Beads } from './beads.ts';
import type { Journal } from './journal.ts';
import type { BudgetLedger, RunLog } from './observability.ts';
import { validateWorkerOutcome } from './schema.ts';
import type { Bead, WorkerSpec } from './types.ts';

export interface TickDeps {
  beads: Beads;
  journal: Journal;
  log: RunLog;
  ledger: BudgetLedger;
  /** Implements the bead. */
  dealer: WorkerAdapter;
  /** INDEPENDENT verifier — never the dealer instance, never its worktree/context (spec §4.1). */
  auditor: WorkerAdapter;
  mechanicalGate: (worktree: string) => Promise<{ green: boolean }>;
  worktreeRoot: string;
}

export interface TickResult {
  claimed?: string;
  closed?: string | null;
  skipped?: string;
  reason?: string;
}

function specFor(bead: Bead, role: 'dealer' | 'auditor', worktree: string): WorkerSpec {
  return {
    beadId: bead.id,
    role,
    model: 'sonnet',
    worktree,
    systemPrompt:
      role === 'dealer'
        ? 'You are a Dealer: implement one bead test-first.'
        : 'You are the Floor Auditor: verify against acceptance; you did NOT implement this.',
    task: `Bead ${bead.id}. Emit a WorkerOutcome JSON.`,
    allowedTools: role === 'auditor' ? ['Read', 'Bash'] : ['Read', 'Edit', 'Write', 'Bash'],
    // Fire under bypassPermissions; the worker has no bd-write path regardless (spec §4.1).
    disallowedTools: [...BD_WRITE_DENY, ...IRREVERSIBLE_DENY],
  };
}

/** One deterministic single-bead tick. The driver — not an LLM — sequences this (spec §3.1/§5.2). */
export async function runSingleBeadTick(d: TickDeps): Promise<TickResult> {
  const ready = await d.beads.ready();
  if (ready.length === 0) return { reason: 'queue-empty' };
  const bead = ready[0];

  // Idempotent resume: an already-closed bead is never re-closed (spec §5.6).
  if (d.journal.hasDone('close', bead.id)) {
    await d.log.write({ kind: 'skip', beadId: bead.id });
    return { skipped: bead.id };
  }

  await d.journal.append({ type: 'claim', beadId: bead.id });
  await d.beads.claim(bead.id);
  await d.log.write({ kind: 'claim', beadId: bead.id });

  const worktree = `${d.worktreeRoot}/wt-${bead.id}`;

  // Dealer implements.
  const dealerOut = await d.dealer.run(specFor(bead, 'dealer', worktree));
  const dv = validateWorkerOutcome(dealerOut);
  if (!dv.ok)
    return { claimed: bead.id, closed: null, reason: `dealer-outcome-invalid:${dv.error}` };
  d.ledger.add(dealerOut.costUsd);
  await d.journal.append({ type: 'dispatch', beadId: bead.id, role: 'dealer' });
  await d.log.write({
    kind: 'dispatch',
    beadId: bead.id,
    role: 'dealer',
    costUsd: dealerOut.costUsd,
  });

  // Mechanical gate (the repo's real typecheck/lint/test/build). No green, no close.
  const gate = await d.mechanicalGate(worktree);
  if (!gate.green) {
    await d.log.write({ kind: 'gate-red', beadId: bead.id });
    return { claimed: bead.id, closed: null, reason: 'mechanical-gate-red' };
  }

  // Independent Auditor (different adapter instance/role — author never grades own work).
  const auditOut = await d.auditor.run(specFor(bead, 'auditor', worktree));
  d.ledger.add(auditOut.costUsd);
  await d.log.write({ kind: 'audit', beadId: bead.id, status: auditOut.status });
  if (auditOut.status !== 'done') return { claimed: bead.id, closed: null, reason: 'audit-failed' };

  // Cage serialized close (exactly-once via the journal guard above).
  await d.journal.append({ type: 'close', beadId: bead.id });
  await d.beads.close(bead.id, 'verified by independent auditor');
  await d.log.write({ kind: 'close', beadId: bead.id });
  return { claimed: bead.id, closed: bead.id };
}
