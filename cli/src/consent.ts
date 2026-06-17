import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { stateDir as defaultStateDir } from './paths.ts';

/**
 * The file-based consent contract. Both the TUI modal and the `the-5-to-9 gate`
 * subcommand read/write the SAME records under `<stateDir>/consent/`, which is
 * already git-excluded — no leak. Every decision is fail-closed:
 *
 *  - A wrong token can NEVER approve (and writes NOTHING).
 *  - Resolution is write-once; a second resolve is a no-op error.
 *  - `awaitResolution` times out to a DENY — never a silent-allow.
 *  - Any parse/IO error is treated as "no resolution" / fail-closed.
 */

/** A pending consent request (an irreversible/outward action awaiting a human). */
export interface PendingConsent {
  id: string;
  command: string;
  category: string;
  beadId: string | null;
  role: string | null;
  /** The canonical confirm string a human must type verbatim to approve. */
  token: string;
  createdAt: string;
}

/** A write-once resolution of a pending consent. */
export interface Resolution {
  id: string;
  approved: boolean;
  /** The token supplied on approve (null for a deny). */
  token: string | null;
  resolvedAt: string;
}

/** The shape `requestConsent` accepts. */
export interface ConsentRequest {
  command: string;
  category: string;
  beadId?: string | null;
  role?: string | null;
  /** Override the canonical confirm string; defaults to a derived value. */
  token?: string;
}

/** Injection seam: state dir + clock, so tests never touch the real state dir. */
export interface ConsentDeps {
  /** Override the consent root (defaults to `stateDir()`). */
  stateDir?: string;
  /** Injectable clock (ms). Defaults to `Date.now`. */
  now?: () => number;
}

/** Options for `awaitResolution` (extends ConsentDeps so a clock can be injected). */
export interface AwaitOpts extends ConsentDeps {
  /** Give up after this many ms and return a DENY. Default 5 minutes. */
  timeoutMs?: number;
  /** Poll cadence in ms. Default 250. */
  pollMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 250;

function consentDir(deps: ConsentDeps): string {
  return join(deps.stateDir ?? defaultStateDir(), 'consent');
}

function pendingPath(dir: string, id: string): string {
  return join(dir, `${id}.pending.json`);
}

function resolvedPath(dir: string, id: string): string {
  return join(dir, `${id}.resolved.json`);
}

/** Atomic write: tmp + rename, so a crash never leaves a half-written record. */
function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, data, { encoding: 'utf8' });
  renameSync(tmp, path);
}

/**
 * Derive the canonical confirm token from the action. It is the human-typed
 * string shown verbatim in the modal — short enough to type, specific enough to
 * be a real confirmation. We use the first word of the command (the verb), or
 * the category if the command is empty.
 */
function deriveToken(req: ConsentRequest): string {
  const firstWord = req.command.trim().split(/\s+/)[0] ?? '';
  return firstWord || req.category || 'confirm';
}

/**
 * Write a pending consent record and return it. The pending file is the durable
 * source of truth — a crash after this re-surfaces the request on resume.
 */
export function requestConsent(req: ConsentRequest, deps: ConsentDeps = {}): PendingConsent {
  const dir = consentDir(deps);
  mkdirSync(dir, { recursive: true });
  const nowMs = (deps.now ?? Date.now)();
  const pending: PendingConsent = {
    id: randomUUID(),
    command: req.command,
    category: req.category,
    beadId: req.beadId ?? null,
    role: req.role ?? null,
    token: req.token && req.token.length > 0 ? req.token : deriveToken(req),
    createdAt: new Date(nowMs).toISOString(),
  };
  atomicWrite(pendingPath(dir, pending.id), JSON.stringify(pending, null, 2));
  return pending;
}

/** Read+parse a pending record by id, or null on missing/corrupt (fail-closed). */
function readPending(dir: string, id: string): PendingConsent | null {
  const p = pendingPath(dir, id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PendingConsent;
  } catch {
    return null;
  }
}

/**
 * List pending consents that have NOT yet been resolved. A corrupt pending file
 * is skipped (never throws) — fail-closed reads.
 */
export function listPending(deps: ConsentDeps = {}): PendingConsent[] {
  const dir = consentDir(deps);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: PendingConsent[] = [];
  for (const name of names) {
    if (!name.endsWith('.pending.json')) continue;
    const id = name.slice(0, -'.pending.json'.length);
    if (existsSync(resolvedPath(dir, id))) continue; // already resolved
    const rec = readPending(dir, id);
    if (rec) out.push(rec);
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

/** Read a resolution by id, or null on missing/corrupt (fail-closed). */
export function readResolution(id: string, deps: ConsentDeps = {}): Resolution | null {
  const dir = consentDir(deps);
  const p = resolvedPath(dir, id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Resolution;
  } catch {
    return null;
  }
}

/**
 * Resolve a pending consent. On approve, the supplied token MUST equal the
 * pending record's token — otherwise this fails and writes NOTHING. Resolution
 * is write-once: a second resolve of the same id is a no-op error.
 */
export function resolve(
  id: string,
  approved: boolean,
  token: string | undefined,
  deps: ConsentDeps = {},
): { ok: boolean; error?: string } {
  const dir = consentDir(deps);
  const pending = readPending(dir, id);
  if (!pending) {
    return { ok: false, error: `no pending consent for id ${id}` };
  }
  // Write-once: refuse if a resolution already exists.
  if (existsSync(resolvedPath(dir, id))) {
    return { ok: false, error: `consent ${id} is already resolved (write-once)` };
  }
  if (approved) {
    // INVARIANT: a wrong token can never approve, and writes nothing.
    if (token !== pending.token) {
      return { ok: false, error: 'token mismatch — approval refused (fail-closed)' };
    }
  }
  const res: Resolution = {
    id,
    approved,
    token: approved ? (token ?? null) : null,
    resolvedAt: new Date((deps.now ?? Date.now)()).toISOString(),
  };
  try {
    atomicWrite(resolvedPath(dir, id), JSON.stringify(res, null, 2));
  } catch (err) {
    return { ok: false, error: `failed to write resolution: ${(err as Error).message}` };
  }
  return { ok: true };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Await a resolution for `id`, polling the resolution file. A pre-existing
 * resolution is returned immediately (resumable). On timeout it returns a DENY
 * resolution — it NEVER silent-allows. The clock is injectable so tests are
 * fast and deterministic.
 */
export async function awaitResolution(id: string, opts: AwaitOpts = {}): Promise<Resolution> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const now = opts.now ?? Date.now;
  const start = now();
  // Loop: read first (resumable), then check the deadline, then sleep.
  for (;;) {
    const res = readResolution(id, opts);
    if (res) return res;
    if (now() - start >= timeoutMs) {
      // Timeout → DENY. Persist it write-once so the decision is durable; if a
      // resolution raced in, honor that one instead.
      resolve(id, false, undefined, opts);
      return (
        readResolution(id, opts) ?? {
          id,
          approved: false,
          token: null,
          resolvedAt: new Date(now()).toISOString(),
        }
      );
    }
    await sleep(pollMs);
  }
}
