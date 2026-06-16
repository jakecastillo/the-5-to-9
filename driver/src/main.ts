import { type Backend, resolveConfig } from './config.ts';

interface ParsedArgs {
  backend?: Backend;
  goal: string;
  budgetUsd?: number;
}

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

// Entry point. Slice 1 proves config resolution + the credential/billing banner; Slice 2+
// wires the full capped loop over runSingleBeadTick.
const cfg = resolveConfig(parseArgv(process.argv.slice(2)));
process.stdout.write(`${cfg.banner}\n`);
