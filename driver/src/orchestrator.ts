import { mkdir } from 'node:fs/promises';
import type { WorkerAdapter } from './adapters/adapter.ts';
import type { Beads } from './beads.ts';
import { type GateConsentDeps, runGate } from './gate-consent.ts';
import type { BudgetLedger, RunLog } from './observability.ts';
import { validateWorkerOutcome } from './schema.ts';
import { specFor } from './worker-spec.ts';
import type { Worktrees } from './worktree.ts';

/**
 * The single-bead tick deps. Extends GateConsentDeps so the interactive consent
 * gate fields (exec/classify/requestConsent/awaitResolution/stateDir/clock) are the
 * SAME shape the shared `runGate` consumes — the K=1 and K>=2 ticks gate identically.
 */
export interface TickDeps extends GateConsentDeps {
  beads: Beads;
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

  // Use the shared Worktrees.pathFor so K=1 and K>=2 paths are identical:
  // `.f9-worktrees/` is a dedicated subdir to keep git-managed worktrees out of
  // the repo root and to match the deterministic pathFor contract used by K>=2.
  const worktree = d.worktrees.pathFor(bead.id);
  await mkdir(worktree, { recursive: true });

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

  // ── Consent gate + perform-on-approve (Phase 1c) ───────────────────────────
  // If the worker SURFACED an outward action it could not run, the driver — not
  // an LLM — asks a human and, ONLY on a type-to-confirm APPROVE, performs the
  // EXACT surfaced command itself (in the bead's worktree). Default-deny on
  // deny/timeout/throw. This is the SINGLE shared perform site (gate-consent.ts);
  // the K>=2 parallel tick uses the very same runGate.
  const gateOutcome = await runGate(d, bead.id, dealerOut.requestedAction, worktree);
  if (gateOutcome !== 'proceed') {
    // Flagged + NOT approved ('denied'), or an APPROVED action whose exec completion
    // is unknown on resume ('indeterminate' — bead 5va). Either way the bead is NOT
    // closed and is left for a human; never silent-allow, never auto-close-without-perform.
    await d.log.write({ kind: 'gate-denied', beadId: bead.id, gate: gateOutcome });
    return {
      claimed: bead.id,
      closed: null,
      reason: gateOutcome === 'indeterminate' ? 'gate-indeterminate' : 'gate-denied',
    };
  }

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
