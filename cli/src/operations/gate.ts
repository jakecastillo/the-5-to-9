import { type ConsentDeps, listPending, resolve as resolveConsent } from '../consent.ts';

/**
 * Scriptable consent operations over the consent contract — the non-TTY path.
 * They thread the CLI's `stateDir` into the same git-excluded consent records
 * the TUI modal reads/writes, so a human (or CI) can approve/deny without a TTY.
 * Every result is `{ ok, message }`; the caller maps `ok=false` to a nonzero
 * exit. Fail-closed: a wrong/missing token can never approve.
 */
export interface GateResult {
  ok: boolean;
  message: string;
}

/** List pending consents as plain text (id · category · command · token). */
export function gatePending(deps: ConsentDeps = {}): GateResult {
  const pending = listPending(deps);
  if (pending.length === 0) {
    return { ok: true, message: 'no pending consent — nothing to approve.' };
  }
  const lines = pending.map(
    (p) =>
      `${p.id}\n  category: ${p.category}\n  command:  ${p.command}\n  token:    ${p.token}\n` +
      `  approve:  the-5-to-9 gate approve ${p.id} --token ${p.token}`,
  );
  return { ok: true, message: `${pending.length} pending:\n${lines.join('\n')}` };
}

/**
 * Approve a pending consent. Requires the exact token. A wrong or missing token
 * fails (nonzero) and writes nothing — the consent module is the gate.
 */
export function gateApprove(
  id: string,
  token: string | undefined,
  deps: ConsentDeps = {},
): GateResult {
  if (token == null || token.length === 0) {
    return { ok: false, message: 'approve refused: --token is required (fail-closed).' };
  }
  const res = resolveConsent(id, true, token, deps);
  if (!res.ok) {
    return { ok: false, message: `approve refused: ${res.error ?? 'unknown error'}` };
  }
  return { ok: true, message: `approved ${id}.` };
}

/** Deny a pending consent (no token needed). */
export function gateDeny(id: string, deps: ConsentDeps = {}): GateResult {
  const res = resolveConsent(id, false, undefined, deps);
  if (!res.ok) {
    return { ok: false, message: `deny failed: ${res.error ?? 'unknown error'}` };
  }
  return { ok: true, message: `denied ${id}.` };
}
