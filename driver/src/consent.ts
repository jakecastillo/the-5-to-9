import { createHash, randomUUID } from 'node:crypto';
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

/**
 * A consent id must be a single safe path component (uuid-shaped) — never a path
 * fragment. Rejecting `..`, slashes, and dots closes the path-traversal vector
 * (F2) where a crafted `id` from `gate approve <id>` could read/write outside the
 * consent dir. Fail-closed: a bad id reads as "nothing" and refuses to resolve.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && SAFE_ID.test(id);
}

/**
 * Exclusive create = atomic write-once (F1). `wx` fails with EEXIST if the file
 * already exists, so two racing resolvers can never both win and a deny can never
 * be clobbered by a later approve — no TOCTOU between check and write.
 */
function writeOnce(path: string, data: string): { ok: boolean; error?: string } {
  try {
    writeFileSync(path, data, { encoding: 'utf8', flag: 'wx' });
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return { ok: false, error: 'already resolved (write-once)' };
    return { ok: false, error: `failed to write resolution: ${(err as Error).message}` };
  }
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
  const verb = firstWord || req.category || 'confirm';
  // Bind the token to the EXACT command (Eye in the Sky Finding A): the hash
  // covers the FULL command, so typing the token confirms THIS command — not any
  // command that merely shares the verb. A chained/altered payload changes the
  // token, so a human can't approve `npm publish && <payload>` by typing `npm`.
  const fingerprint = createHash('sha256').update(req.command).digest('hex').slice(0, 6);
  return `${verb}-${fingerprint}`;
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
  if (!isSafeId(id)) return null;
  const p = pendingPath(dir, id);
  if (!existsSync(p)) return null;
  try {
    const rec = JSON.parse(readFileSync(p, 'utf8')) as PendingConsent;
    // Validate that the JSON id matches the filename-derived id AND is itself
    // safe (F2 / Bug-5 PRIMARY fix). A mismatch is a tampered file — treat as
    // corrupt. This closes the vector where a crafted file with a mismatched
    // id could bypass filename-level checks downstream.
    if (rec.id !== id || !isSafeId(rec.id)) return null;
    return rec;
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
  if (!isSafeId(id)) return null;
  const dir = consentDir(deps);
  const p = resolvedPath(dir, id);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    // Shape-validate (F4): a resolution counts ONLY if `approved` is a real
    // boolean. A non-boolean (e.g. the string "yes") must never read as approval.
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Resolution).approved !== 'boolean'
    ) {
      return null;
    }
    return parsed as Resolution;
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
  if (!isSafeId(id)) {
    return { ok: false, error: 'invalid consent id — refused (fail-closed)' };
  }
  const dir = consentDir(deps);
  const pending = readPending(dir, id);
  if (!pending) {
    return { ok: false, error: `no pending consent for id ${id}` };
  }
  if (approved) {
    // INVARIANT: a wrong/empty token can never approve, and writes nothing. A
    // degenerate pending token (missing/empty) is itself unapprovable (F3) — the
    // gate never trusts a tokenless request.
    if (!pending.token || pending.token.length === 0) {
      return {
        ok: false,
        error: 'pending record has no confirm token — approval refused (fail-closed)',
      };
    }
    if (token !== pending.token) {
      return { ok: false, error: 'token mismatch — approval refused (fail-closed)' };
    }
  }
  mkdirSync(dir, { recursive: true });
  const res: Resolution = {
    id,
    approved,
    token: approved ? (token ?? null) : null,
    resolvedAt: new Date((deps.now ?? Date.now)()).toISOString(),
  };
  // Write-once enforced ATOMICALLY by exclusive create (F1) — no check/write TOCTOU.
  const w = writeOnce(resolvedPath(dir, id), JSON.stringify(res, null, 2));
  if (!w.ok) {
    return {
      ok: false,
      error:
        w.error === 'already resolved (write-once)'
          ? `consent ${id} is already resolved (write-once)`
          : w.error,
    };
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
