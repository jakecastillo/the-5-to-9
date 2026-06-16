import { type Backend, resolveConfig } from './config.ts';

interface ParsedArgs {
  backend?: Backend;
  goal: string;
  budgetUsd?: number;
}

const BACKENDS: Backend[] = ['claude', 'codex', 'api'];

export function parseArgv(argv: string[]): ParsedArgs {
  let backend: Backend | undefined;
  let goal = '';
  let budgetUsd: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--backend') backend = argv[++i] as Backend;
    else if (argv[i] === '--goal') goal = argv[++i] ?? '';
    else if (argv[i] === '--budget-usd') budgetUsd = Number(argv[++i]);
  }
  return { backend, goal, budgetUsd };
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

/** CLI entry point. Returns the process exit code. */
export function main(argv: string[]): number {
  if (isHelpRequested(argv)) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const parsed = parseArgv(argv);
  const backendError = validateBackend(parsed.backend);
  if (backendError) {
    process.stderr.write(`${backendError}\n`);
    return 1;
  }
  // Slice 1 proves config resolution + the credential/billing banner; Slice 2+
  // wires the full capped loop over runSingleBeadTick.
  const cfg = resolveConfig(parsed);
  process.stdout.write(`${cfg.banner}\n`);
  return 0;
}

// Run only when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
