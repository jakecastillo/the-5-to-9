import type { WorkerAdapter } from './adapters/adapter.ts';
import type { Beads } from './beads.ts';
import {
  type ConsentRequest,
  type PendingConsent,
  type Resolution,
  awaitResolution as defaultAwaitResolution,
  requestConsent as defaultRequestConsent,
} from './consent.ts';
import type { ExecFn } from './exec.ts';
import { realExec } from './exec.ts';
import { type GateVerdict, classifyCommand } from './gate.ts';
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

  // ── Phase 1c: the interactive consent gate + perform-on-approve ────────────
  // All optional with safe defaults so callers that never surface an outward
  // action need not wire them. The gate fires ONLY when a worker surfaces a
  // non-empty, FLAGGED requestedAction.
  /**
   * Performs an APPROVED outward command. Defaults to realExec. The orchestrator
   * execs the EXACT stored command verbatim — no re-derivation. Distinct from the
   * bd/git exec inside Beads/Worktrees.
   */
  exec?: ExecFn;
  /** Classify a command as irreversible. Defaults to the shared hook classifier. */
  classify?: (cmd: string) => GateVerdict;
  /** Write the pending consent. Defaults to consent.requestConsent (bound to stateDir). */
  requestConsent?: (req: ConsentRequest) => PendingConsent;
  /** Await the human decision. Defaults to consent.awaitResolution (fail-closed). */
  awaitResolution?: (id: string) => Promise<Resolution>;
  /** Where consent records live (the default request/await bind to it). */
  stateDir?: string;
  /** Injectable clock (ms) for the default consent timeout. Tests inject it. */
  now?: () => number;
  /** Override the default consent timeout (ms). */
  consentTimeoutMs?: number;
  /** Override the default consent poll cadence (ms). */
  consentPollMs?: number;
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

  // ── Consent gate + perform-on-approve (Phase 1c) ───────────────────────────
  // If the worker SURFACED an outward action it could not run, the driver — not
  // an LLM — asks a human and, ONLY on a type-to-confirm APPROVE, performs the
  // EXACT surfaced command itself. Default-deny on deny/timeout/throw. This is
  // the SINGLE perform site; it is guarded by `approved === true` (see runGate).
  const gateOutcome = await runGate(d, bead.id, dealerOut.requestedAction);
  if (gateOutcome === 'denied') {
    // The action was flagged and NOT approved (deny / timeout / error). The bead
    // stays blocked — it is NOT closed. Never silent-allow.
    await d.log.write({ kind: 'gate-denied', beadId: bead.id });
    return { claimed: bead.id, closed: null, reason: 'gate-denied' };
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

/** The outcome of the consent gate for a surfaced action. */
type GateOutcome =
  /** No flagged action, or a flagged action that was APPROVED + performed (or already done). */
  | 'proceed'
  /** A flagged action that was NOT approved (deny / timeout / any thrown error). */
  | 'denied';

/**
 * The driver-side consent gate (Phase 1c). It is the SINGLE place that may exec a
 * worker-surfaced outward action, and it does so only behind a passed checkpoint:
 *
 *  - No / empty / non-string action            → 'proceed' (the gate never fires).
 *  - A benign (non-flagged) action             → 'proceed' (no consent requested).
 *  - Already journaled `gate` for this bead     → 'proceed' WITHOUT re-performing
 *                                                 (idempotent resume; mirrors the
 *                                                 close/merge hasDone guards).
 *  - Flagged + human APPROVE (approved===true)  → exec the BYTE-EXACT command, then
 *                                                 'proceed'.
 *  - Flagged + deny / timeout / ANY thrown error → 'denied' (default-deny; no exec).
 *
 * Exact-command integrity: the string classified, sent for consent, and execed is
 * the same `requestedAction` value — no re-derivation, normalization, or mutation.
 */
async function runGate(
  d: TickDeps,
  beadId: string,
  requestedAction: string | undefined,
): Promise<GateOutcome> {
  // No outward action surfaced → the gate never fires.
  if (typeof requestedAction !== 'string' || requestedAction.length === 0) return 'proceed';

  const classify = d.classify ?? classifyCommand;
  const verdict = classify(requestedAction);
  // A benign (non-irreversible) action proceeds with NO consent and NO perform.
  if (!verdict.denied) return 'proceed';

  // Idempotent resume: a decision already journaled is NOT replayed — an
  // approved action is not re-performed, a denied one is not re-asked.
  if (d.journal.hasDone('gate', beadId)) return 'proceed';

  // Bind the default consent contract to this run's stateDir + clock.
  const stateDir = d.stateDir;
  const requestConsent =
    d.requestConsent ??
    ((req: ConsentRequest) => defaultRequestConsent(req, { stateDir, now: d.now }));
  const awaitResolution =
    d.awaitResolution ??
    ((id: string) =>
      defaultAwaitResolution(id, {
        stateDir,
        now: d.now,
        timeoutMs: d.consentTimeoutMs,
        pollMs: d.consentPollMs,
      }));
  const exec = d.exec ?? realExec;

  // Self-default-deny: ANY failure to request / await / journal / perform consent
  // must NOT exec — the gate never relies on its caller to fail closed.
  try {
    const pending = requestConsent({
      command: requestedAction,
      category: verdict.segment ?? requestedAction,
      beadId,
      role: 'dealer',
    });
    const resolution = await awaitResolution(pending.id);

    // Journal the decision BEFORE performing — durable, and the resume guard.
    await d.journal.append({
      type: 'gate',
      beadId,
      command: requestedAction,
      segment: verdict.segment,
      approved: resolution.approved === true,
      resolvedAt: resolution.resolvedAt,
    });

    // Perform ONLY on an explicit boolean-true approval. Exec the EXACT stored
    // command verbatim — the byte-identical string the human approved.
    if (resolution.approved === true) {
      await exec('bash', ['-c', requestedAction], { cwd: `${d.worktreeRoot}/wt-${beadId}` });
      return 'proceed';
    }
    return 'denied';
  } catch {
    // Default-deny: a thrown error anywhere in the path performs NOTHING.
    return 'denied';
  }
}
