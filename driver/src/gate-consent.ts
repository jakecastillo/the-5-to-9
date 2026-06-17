import {
  type ConsentRequest,
  type PendingConsent,
  type Resolution,
  awaitResolution as defaultAwaitResolution,
  requestConsent as defaultRequestConsent,
} from './consent.ts';
import { type ExecFn, realExec } from './exec.ts';
import { type GateVerdict, classifyCommand } from './gate.ts';
import type { Journal } from './journal.ts';

/**
 * The dependency subset the consent gate needs. Shared verbatim by BOTH the K=1
 * single-bead tick (orchestrator.ts) and the K>=2 parallel tick (parallel.ts), so
 * an outward action is gated IDENTICALLY regardless of concurrency. There is one
 * consent contract and one perform site — no duplicated logic per path.
 */
export interface GateConsentDeps {
  journal: Journal;

  // ── The interactive consent gate + perform-on-approve (Phase 1c) ───────────
  // All optional with safe defaults so callers that never surface an outward
  // action need not wire them. The gate fires ONLY when a worker surfaces a
  // non-empty, FLAGGED requestedAction.
  /**
   * Performs an APPROVED outward command. Defaults to realExec. The gate execs the
   * EXACT stored command verbatim — no re-derivation. Distinct from the bd/git exec.
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

/** The outcome of the consent gate for a surfaced action. */
export type GateOutcome =
  /** No flagged action, or a flagged action APPROVED + PERFORMED (or already done). */
  | 'proceed'
  /** A flagged action that was NOT approved (deny / timeout / any thrown error). */
  | 'denied'
  /**
   * Phase 1c follow-up (bead 5va): an APPROVED action whose exec completion is
   * UNKNOWN — the approve was journaled but no performed-marker exists (a crash
   * landed between the approve-journal and a successful exec). The action may have
   * partially run, so we MUST NOT re-exec it and MUST NOT close the bead. A human
   * re-decides. The tick treats this like 'denied' for closing purposes, but it is
   * a DISTINCT, observable state — never a silent skip-and-close.
   */
  | 'indeterminate';

/**
 * The driver-side consent gate (Phase 1c + follow-ups). It is the SINGLE place that
 * may exec a worker-surfaced outward action, and it does so only behind a passed
 * checkpoint:
 *
 *  - No / empty / non-string action            → 'proceed' (the gate never fires).
 *  - A benign (non-flagged) action             → 'proceed' (no consent requested).
 *  - Flagged + human APPROVE (approved===true)  → exec the BYTE-EXACT command, journal
 *                                                 a distinct 'gate-performed' marker,
 *                                                 then 'proceed'.
 *  - Flagged + deny / timeout / ANY thrown error → 'denied' (default-deny; no exec).
 *
 * Resume semantics (bead 5va — close the journaled-approve-but-not-exec'd window):
 *  - 'gate-performed' journaled       → 'proceed' WITHOUT re-performing (approved AND
 *                                        performed; idempotent — never double-exec).
 *  - approved 'gate' but NOT performed → 'indeterminate' (a crash landed between the
 *                                        approve-journal and a successful exec; do NOT
 *                                        re-exec an irreversible op, do NOT close — a
 *                                        human re-decides).
 *  - denied 'gate' (approved:false)    → 'denied' (a clean, non-performed decision).
 *
 * Exact-command integrity: the string classified, sent for consent, and execed is
 * the same `requestedAction` value — no re-derivation, normalization, or mutation.
 *
 * @param cwd The working directory the APPROVED command runs in — the bead's own
 *   worktree. The caller resolves it (the K=1 and K>=2 paths compute it differently);
 *   the gate never recomputes a worktree path.
 */
export async function runGate(
  d: GateConsentDeps,
  beadId: string,
  requestedAction: string | undefined,
  cwd: string,
): Promise<GateOutcome> {
  // No outward action surfaced → the gate never fires.
  if (typeof requestedAction !== 'string' || requestedAction.length === 0) return 'proceed';

  const classify = d.classify ?? classifyCommand;
  const verdict = classify(requestedAction);
  // A benign (non-irreversible) action proceeds with NO consent and NO perform.
  if (!verdict.denied) return 'proceed';

  // ── Idempotent resume (bead 5va) ───────────────────────────────────────────
  // An APPROVED action that was actually PERFORMED carries a distinct marker. If
  // it exists, the action ran exactly once — proceed without re-performing.
  if (d.journal.hasDone('gate-performed', beadId)) return 'proceed';
  // A decision was already journaled but NO performed-marker exists. Branch on the
  // recorded approval: a deny is a clean non-performed decision; an approve whose
  // perform never completed is INDETERMINATE (do NOT re-exec, do NOT close).
  if (d.journal.hasDone('gate', beadId)) {
    const prior = d.journal.find('gate', beadId);
    return prior?.approved === true ? 'indeterminate' : 'denied';
  }

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
      await exec('bash', ['-c', requestedAction], { cwd });
      // Journal the performed-marker AFTER a successful exec (bead 5va). On resume
      // this proves the action ran exactly once; without it an approved-but-unperformed
      // action is INDETERMINATE, never silently skipped-and-closed.
      await d.journal.append({ type: 'gate-performed', beadId, command: requestedAction });
      return 'proceed';
    }
    return 'denied';
  } catch {
    // Default-deny: a thrown error anywhere in the path performs NOTHING. If the
    // throw landed AFTER the approve-journal but during/after exec, resume will see
    // approved-without-performed and return 'indeterminate' (never auto-close).
    return 'denied';
  }
}
