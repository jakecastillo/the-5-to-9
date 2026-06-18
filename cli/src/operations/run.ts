import { type SpawnOptions, spawn as realSpawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type PendingConsent,
  type Resolution,
  awaitResolution as defaultAwaitResolution,
  requestConsent as defaultRequestConsent,
} from '../consent.ts';
import { type GateVerdict, classifyCommand } from '../gate.ts';
import { stateDir as defaultStateDir } from '../paths.ts';

/** A handle to a detached driver run. */
export interface RunHandle {
  pid: number;
  journalPath: string;
  detached: true;
}

export interface RunOpts {
  maxIterations?: number;
  backend?: 'claude' | 'codex' | 'api';
  concurrency?: number;
}

/** A minimal spawn shape — injectable so tests don't fork real processes. */
export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => { pid?: number; unref: () => void };

export interface RunDeps {
  spawn?: SpawnFn;
  /** Override the state dir (journal lives under it). Defaults to stateDir(). */
  stateDir?: string;
  /** The shift branch — used to namespace the run's journal dir. */
  branch?: string;
  /** Override the resolved driver entry (a node-runnable path). */
  driverEntry?: string;
}

/** Resolve the driver's main entry (dev: TS source under the driver package). */
function resolveDriverEntry(): string {
  // cli/src/operations/run.ts → ../../../driver/src/main.ts
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'driver', 'src', 'main.ts');
}

function safeBranch(branch: string): string {
  // Keep the slash structure but strip anything path-hostile.
  const sanitized = branch.replace(/[^A-Za-z0-9/_.-]/g, '_');
  // An empty or all-illegal name collapses to '' → use 'current' to avoid a
  // bare runs/ path component that collides with other branches.
  return sanitized || 'current';
}

/**
 * Start a detached driver run. Spawns node against the driver entry with
 * `{ detached: true, stdio: 'ignore' }` and unrefs it, so the CLI/TUI can exit
 * (or be killed) without taking the run down. Returns the predicted journal path.
 *
 * The journal path is exported to the child via FIVE_TO_NINE_JOURNAL so the CLI
 * controls where the run writes; wiring the driver to honor it is a follow-up
 * (the driver currently writes journal.jsonl into its own state dir).
 */
export async function startRun(opts: RunOpts, deps: RunDeps = {}): Promise<RunHandle> {
  const spawn = deps.spawn ?? (realSpawn as unknown as SpawnFn);
  const dir = deps.stateDir ?? defaultStateDir();
  const branch = safeBranch(deps.branch ?? 'current');
  const entry = deps.driverEntry ?? resolveDriverEntry();

  const runDir = join(dir, 'runs', branch);
  const journalPath = join(runDir, `journal-${Date.now()}.jsonl`);
  try {
    mkdirSync(runDir, { recursive: true });
  } catch {
    // best-effort: the driver also mkdir -p's its journal dir
  }

  const driverArgs: string[] = [];
  if (opts.backend) driverArgs.push('--backend', opts.backend);
  if (opts.maxIterations != null) driverArgs.push('--max-iterations', String(opts.maxIterations));
  if (opts.concurrency != null) driverArgs.push('--concurrency', String(opts.concurrency));

  // node --import tsx <driver-main> <driver-args...>  (tsx strips TS at runtime in dev)
  const nodeArgs = ['--import', 'tsx', entry, ...driverArgs];

  const child = spawn('node', nodeArgs, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, FIVE_TO_NINE_JOURNAL: journalPath },
  });
  child.unref();

  return { pid: child.pid ?? -1, journalPath, detached: true };
}

// ── Interactive consent checkpoint (Phase 1b) ────────────────────────────────

/** The flagged action a run is about to take. */
export interface CheckpointAction {
  command: string;
  beadId?: string | null;
  role?: string | null;
}

/** A minimal journal sink — the driver's Journal satisfies this (append). */
export interface JournalSink {
  append(event: { type: 'gate'; [k: string]: unknown }): Promise<void> | void;
}

/** Everything injectable so the checkpoint is testable with no TTY / no sleep. */
export interface CheckpointDeps {
  /** Where consent records live (defaults to stateDir()). */
  stateDir?: string;
  /** Journal sink for the `'gate'` event. */
  journal: JournalSink;
  /** The irreversible classifier (defaults to gate.classifyCommand). */
  classify?: (cmd: string) => GateVerdict;
  /** Write the pending consent (defaults to consent.requestConsent). */
  requestConsent?: (input: {
    command: string;
    category: string;
    beadId?: string | null;
    role?: string | null;
  }) => PendingConsent;
  /** Await the resolution (defaults to consent.awaitResolution). */
  awaitResolution?: (id: string) => Promise<Resolution>;
  /** Injected clock for the default awaitResolution timeout (tests). */
  now?: () => number;
  /** Timeout for the default awaitResolution. */
  timeoutMs?: number;
  /** Poll cadence for the default awaitResolution. */
  pollMs?: number;
}

/** The outcome of a consent checkpoint. */
export interface CheckpointResult {
  /** True when the run may take the action (benign, or human-approved). */
  proceed: boolean;
  /** True when a flagged action was skipped (denied or timed out). */
  skipped: boolean;
  /** The resolution, when consent was requested. */
  resolution?: Resolution;
  /**
   * When set, a journal-append threw during an otherwise-approved action. The
   * checkpoint is still fail-closed (proceed:false, skipped:true) — this field
   * makes the cause observable so callers can log/alert rather than silently deny.
   */
  journalError?: string;
}

/**
 * The orchestrator-level consent gate (Phase 1b). At the point a run would
 * otherwise hard-stop on an irreversible/outward action, it asks a human:
 *
 *  - benign command           → proceed, no consent requested.
 *  - flagged + APPROVED       → proceed; journal a `'gate'` event (approved).
 *  - flagged + DENIED/TIMEOUT → skip the action, record it, journal a `'gate'`
 *                               event (approved=false) and continue. Never
 *                               silent-allows — `awaitResolution` is fail-closed
 *                               (default DENY on timeout / parse error).
 *
 * This does NOT change the sandboxed-worker model or its `IRREVERSIBLE_DENY`
 * rules; it governs only the decision to proceed past a flagged action.
 */
export async function consentCheckpoint(
  action: CheckpointAction,
  deps: CheckpointDeps,
): Promise<CheckpointResult> {
  const classify = deps.classify ?? classifyCommand;
  const verdict = classify(action.command);
  if (!verdict.denied) {
    return { proceed: true, skipped: false };
  }

  const stateDir = deps.stateDir;
  const request =
    deps.requestConsent ?? ((input) => defaultRequestConsent(input, { stateDir, now: deps.now }));
  const await_ =
    deps.awaitResolution ??
    ((id) =>
      defaultAwaitResolution(id, {
        stateDir,
        now: deps.now,
        timeoutMs: deps.timeoutMs,
        pollMs: deps.pollMs,
      }));

  // Self-default-deny: ANY failure requesting/awaiting consent must NOT proceed
  // — the checkpoint never relies on its caller to fail closed.
  let resolution: Resolution;
  try {
    const pending = request({
      command: action.command,
      category: verdict.segment ?? action.command,
      beadId: action.beadId ?? null,
      role: action.role ?? null,
    });
    resolution = await await_(pending.id);
  } catch {
    return { proceed: false, skipped: true };
  }

  // Journal the gate event. A journal failure is fail-closed (deny) but the
  // reason is surfaced via journalError so callers can observe it rather than
  // silently treating it as a plain deny.
  try {
    await deps.journal.append({
      type: 'gate',
      beadId: action.beadId ?? undefined,
      role: action.role ?? undefined,
      command: action.command,
      segment: verdict.segment,
      approved: resolution.approved === true,
      resolvedAt: resolution.resolvedAt,
    });
  } catch (err) {
    return {
      proceed: false,
      skipped: true,
      journalError: (err as Error).message,
    };
  }

  // Proceed ONLY on an explicit boolean-true approval.
  if (resolution.approved === true) {
    return { proceed: true, skipped: false, resolution };
  }
  // Fail-closed: denied or timed out → skip the action, do not proceed.
  return { proceed: false, skipped: true, resolution };
}
