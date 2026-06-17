import { join } from 'node:path';
import type { WorkerAdapter } from './adapters/adapter.ts';
import { ClaudeAdapter } from './adapters/claude.ts';
import { CodexAdapter } from './adapters/codex.ts';
import { Beads } from './beads.ts';
import { type Backend, type RunConfig, resolveConfig } from './config.ts';
import { realExec } from './exec.ts';
import type { ExecFn } from './exec.ts';
import { Journal } from './journal.ts';
import { type ShiftReport, runShift } from './loop.ts';
import { BudgetLedger, RunLog } from './observability.ts';
import { type TickDeps, runSingleBeadTick } from './orchestrator.ts';
import { type ParallelTickDeps, runParallelTick } from './parallel.ts';
import { Worktrees } from './worktree.ts';
import { WriteQueue } from './write-queue.ts';

interface ParsedArgs {
  backend?: Backend;
  goal: string;
  budgetUsd?: number;
  concurrency?: number;
  maxIterations?: number;
  noProgressWindow?: number;
}

const BACKENDS: Backend[] = ['claude', 'codex', 'api'];

export function parseArgv(argv: string[]): ParsedArgs {
  let backend: Backend | undefined;
  let goal = '';
  let budgetUsd: number | undefined;
  let concurrency: number | undefined;
  let maxIterations: number | undefined;
  let noProgressWindow: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--backend') backend = argv[++i] as Backend;
    else if (argv[i] === '--goal') goal = argv[++i] ?? '';
    else if (argv[i] === '--budget-usd') budgetUsd = Number(argv[++i]);
    else if (argv[i] === '--concurrency' || argv[i] === '-K') concurrency = Number(argv[++i]);
    else if (argv[i] === '--max-iterations') maxIterations = Number(argv[++i]);
    else if (argv[i] === '--no-progress-window') noProgressWindow = Number(argv[++i]);
  }
  return { backend, goal, budgetUsd, concurrency, maxIterations, noProgressWindow };
}

/** The usage text printed for `--help`, listing every flag. */
export function usage(): string {
  return [
    'the-5-to-9 driver — clock in a night-shift run.',
    '',
    'Usage: tsx src/main.ts --backend <claude|codex|api> [--goal <text>] [--budget-usd <n>]',
    '',
    'Flags:',
    '  --backend claude|codex|api   Required. Which engine bills this shift.',
    '  --goal <text>                Optional. The objective for the run.',
    '  --budget-usd <n>             Optional. Spend cap in USD (metered-api default $5).',
    '  --concurrency <n>, -K <n>    Optional. Worker pool size (api only; others forced to 1).',
    '  --max-iterations <n>         Optional. Cap on shift iterations (default 30).',
    '  --no-progress-window <n>     Optional. No-progress stop window (default 3).',
    '  -h, --help                   Show this message and exit.',
  ].join('\n');
}

/** True when the caller asked for help (`-h`/`--help`). */
export function isHelpRequested(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

/**
 * Validate a `--backend` value. Returns `undefined` when the value is a known
 * backend (or absent — `resolveConfig` owns the "missing backend" error), or a
 * clear one-line error naming the valid backends when it is unknown.
 */
export function validateBackend(backend: string | undefined): string | undefined {
  if (backend === undefined) return undefined;
  if ((BACKENDS as string[]).includes(backend)) return undefined;
  return `unknown --backend '${backend}': valid backends are ${BACKENDS.join(', ')}`;
}

/**
 * Factory type: given a backend name and exec, returns a WorkerAdapter.
 * Injectable for tests (MockAdapter seam); production uses Claude/Codex adapters.
 */
export type AdapterFactory = (backend: string, exec: ExecFn) => WorkerAdapter;

/** Default production adapter factory: selects ClaudeAdapter or CodexAdapter by backend. */
const defaultAdapterFactory: AdapterFactory = (backend: string, exec: ExecFn): WorkerAdapter => {
  if (backend === 'codex') {
    return new CodexAdapter(exec, {
      schemaPath: join(import.meta.dirname ?? '.', 'schemas', 'worker-outcome.json'),
    });
  }
  // 'claude' and 'api' both use ClaudeAdapter (api uses same claude binary with API key)
  return new ClaudeAdapter(exec);
};

/** Optional overrides for main() — used by tests to inject mocks without touching the process. */
export interface MainOpts {
  /** Override the state directory (default: .claude/five-to-nine). */
  stateDir?: string;
  /** Override the repo root used for Worktrees (default: process.cwd()). */
  repoRoot?: string;
  /** Override the worktreeRoot path (default: repoRoot). */
  worktreeRoot?: string;
  /** Override stdout for output (default: process.stdout). */
  stdout?: { write: (s: string) => boolean | undefined };
  /** Injectable clock (ms) for the consent gate timeout — tests inject it. */
  now?: () => number;
  /** Override the consent gate timeout (ms). Tests use a tiny value. */
  consentTimeoutMs?: number;
  /** Override the consent gate poll cadence (ms). */
  consentPollMs?: number;
}

/** CLI entry point. Returns the process exit code. Now async (Slice 2). */
export async function main(
  argv: string[],
  exec: ExecFn = realExec,
  adapterFactory: AdapterFactory = defaultAdapterFactory,
  opts: MainOpts = {},
): Promise<number> {
  const out = opts.stdout ?? process.stdout;

  if (isHelpRequested(argv)) {
    out.write(`${usage()}\n`);
    return 0;
  }

  const parsed = parseArgv(argv);
  const backendError = validateBackend(parsed.backend);
  if (backendError) {
    process.stderr.write(`${backendError}\n`);
    return 1;
  }

  let cfg: RunConfig;
  try {
    cfg = resolveConfig(parsed);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  out.write(`${cfg.banner}\n`);

  // --- Composition root (Slice 2) ---
  const repoRoot = opts.repoRoot ?? process.cwd();
  const stateDir = opts.stateDir ?? join(repoRoot, '.claude', 'five-to-nine');
  const worktreeRoot = opts.worktreeRoot ?? repoRoot;

  // 1. WriteQueue → Beads (single-writer guarantee, spec §3.2)
  const queue = new WriteQueue();
  const beads = new Beads(exec, queue, repoRoot);

  // 2. Journal (seeded via Journal.replay for crash-safe idempotent resume, spec §5.6)
  const journalPath = join(stateDir, 'journal.jsonl');
  const replayed = await Journal.replay(journalPath);
  const journal = new Journal(journalPath, replayed);

  // 3. RunLog + BudgetLedger
  const log = new RunLog(join(stateDir, 'events.jsonl'));
  const ledger = new BudgetLedger(cfg.budgetUsd, cfg.budgetTokens);

  // 4. Worktrees (git-worktree management, spec §5.2/§8)
  const worktrees = new Worktrees(exec, repoRoot);

  // 5. Adapters: dealer + SEPARATE auditor (author never grades own work, spec §4.1)
  const dealer = adapterFactory(cfg.backend, exec);
  const auditor = adapterFactory(cfg.backend, exec);

  // 6. Build tick closure — K>=2 (api): parallel tick; K=1: single-bead tick (spec §3.1).
  let tick: (iteration: number) => Promise<{ closedIds: string[]; empty: boolean }>;

  if (cfg.concurrency >= 2) {
    // Parallel path: ParallelTickDeps → runParallelTick (returns TickOutcome directly).
    const parallelDeps: ParallelTickDeps = {
      beads,
      worktrees,
      journal,
      log,
      ledger,
      dealer,
      auditor,
      mechanicalGate: async () => ({ green: true }), // TODO: wire real gate (Slice 3)
      k: cfg.concurrency,
      baseBranch: 'main',
    };
    tick = async (_iteration: number) => runParallelTick(parallelDeps);
  } else {
    // K=1 path: runSingleBeadTick — now wired with the interactive consent gate.
    const tickDeps: TickDeps = {
      beads,
      journal,
      log,
      ledger,
      dealer,
      auditor,
      mechanicalGate: async () => ({ green: true }), // TODO: wire real gate (Slice 3)
      worktreeRoot,
      worktrees,
      baseBranch: 'main',
      // Phase 1c: the consent gate performs an APPROVED outward action via this exec
      // (the composition-root exec). The orchestrator's defaults bind requestConsent/
      // awaitResolution/classify to the real consent contract under this stateDir;
      // any deny/timeout/error leaves the bead blocked (default-deny).
      exec,
      stateDir,
      now: opts.now,
      consentTimeoutMs: opts.consentTimeoutMs,
      consentPollMs: opts.consentPollMs,
    };
    tick = async (_iteration: number) => {
      const result = await runSingleBeadTick(tickDeps);
      return {
        closedIds: result.closed != null ? [result.closed] : [],
        empty: result.reason === 'queue-empty',
      };
    };
  }

  // 7. Run the capped shift loop
  let report: ShiftReport;
  try {
    report = await runShift({
      tick,
      ledger,
      log,
      journal,
      maxIterations: cfg.maxIterations,
      noProgressWindow: cfg.noProgressWindow,
    });
  } catch (err) {
    process.stderr.write(`shift error: ${(err as Error).message}\n`);
    return 1;
  }

  // 9. Print the ShiftReport
  out.write(
    `ShiftReport: iterations=${report.iterations} closed=[${report.closed.join(',')}] stopped=${report.stopped}\n`,
  );

  return report.stopped === 'budget' ? 2 : 0;
}

// Run only when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
