import type { WorkerAdapter } from './adapters/adapter.ts';
import type { Beads } from './beads.ts';
import type { Journal } from './journal.ts';
import type { BudgetLedger, RunLog } from './observability.ts';
import { validateWorkerOutcome } from './schema.ts';
import { specFor } from './worker-spec.ts';
import type { Worktrees } from './worktree.ts';

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
  /** Used to merge the bead's branch onto baseBranch before close (spec §h02). */
  worktrees: Worktrees;
  baseBranch: string;
}

export interface TickResult {
  claimed?: string;
  closed?: string | null;
  skipped?: string;
  reason?: string;
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

  // Cage integration: merge the bead's branch onto the base branch (exactly-once via journal).
  const branch = `shift/${bead.id}`;
  if (!d.journal.hasDone('merge', bead.id)) {
    await d.journal.append({ type: 'merge', beadId: bead.id });
    await d.worktrees.merge(d.baseBranch, branch);
    await d.log.write({ kind: 'merge', beadId: bead.id });
  }

  // Cage serialized close (exactly-once via the journal guard above).
  await d.journal.append({ type: 'close', beadId: bead.id });
  await d.beads.close(bead.id, 'verified by independent auditor');
  await d.log.write({ kind: 'close', beadId: bead.id });
  return { claimed: bead.id, closed: bead.id };
}
