import { type SpawnOptions, spawn as realSpawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  return branch.replace(/[^A-Za-z0-9/_.-]/g, '_');
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
