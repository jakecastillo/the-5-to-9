import { Command, CommanderError } from 'commander';
import { type BeadsRead, makeBeadsRead } from './beads-read.ts';
import { effectiveBackend, readConfig, setConfig } from './config-file.ts';
import { clockIn } from './operations/clock-in.ts';
import { clockOut } from './operations/clock-out.ts';
import { getDashboardModel } from './operations/dashboard-model.ts';
import { doctor } from './operations/doctor.ts';
import { startRun } from './operations/run.ts';
import { status } from './operations/status.ts';
import { stateDir as defaultStateDir } from './paths.ts';
import { launchTui as defaultLaunchTui } from './ui/launch.ts';

/** Output sink — defaults to process stdout/stderr. */
export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

/** Injection seam for the whole CLI: a beads adapter, a state dir, a repo cwd. */
export interface CliDeps {
  beads?: BeadsRead;
  stateDir?: string;
  cwd?: string;
  /** Launch the interactive TUI (injectable so tests don't render Ink). */
  launchTui?: () => Promise<void>;
}

const VERSION = '0.2.0';

function resolveDeps(deps: CliDeps) {
  const beads = deps.beads ?? makeBeadsRead();
  const stateDir = deps.stateDir ?? defaultStateDir();
  return { beads, stateDir, cwd: deps.cwd };
}

function renderStatus(view: Awaited<ReturnType<typeof status>>): string {
  const s = view.state;
  const lines: string[] = [];
  if (!s.active) {
    lines.push('no active shift — run `the-5-to-9 clock-in <goal>` to start one');
  } else {
    const cap = s.maxIterations === 'uncapped' || s.maxIterations === '' ? '∞' : s.maxIterations;
    lines.push(`goal:      ${s.goal || '(none)'}`);
    lines.push(`branch:    ${s.branch || '(none)'}`);
    lines.push(`iteration: ${s.iteration} / ${cap}`);
  }
  const g = view.gate;
  lines.push(g ? `gate:      ${g.color} (${g.count} groups) — ${g.ts}` : 'gate:      n/a');
  lines.push(
    `backlog:   ready ${view.readyCount} · in_progress ${view.counts.inProgress} · ` +
      `blocked ${view.counts.blocked} · closed ${view.counts.closed}`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Build the commander program. Wired to write through `io` and to throw (never
 * call process.exit) so runCli can map outcomes to exit codes.
 */
function buildProgram(io: Io, deps: CliDeps): Command {
  const program = new Command();
  const { beads, stateDir, cwd } = resolveDeps(deps);

  program
    .name('the-5-to-9')
    .description('The 5 to 9 — clock in a night-shift crew and drive a repo to done.')
    .version(VERSION)
    .configureOutput({
      writeOut: (s) => io.out(s),
      writeErr: (s) => io.err(s),
    })
    .exitOverride();

  program
    .command('clock-in')
    .description('open a shift: write state and switch to a dedicated shift branch')
    .argument('[goal...]', 'the goal for this shift (free text)')
    .option('--no-branch', 'do not create/switch the shift branch (state only)')
    .action(async (goalParts: string[], opts: { branch?: boolean }) => {
      const res = await clockIn(goalParts.join(' '), { cwd, noBranch: opts.branch === false });
      io.out(`Shift open. Goal recorded. Branch: ${res.branch}.\n`);
      for (const w of res.warnings) io.err(`warning: ${w}\n`);
    });

  program
    .command('clock-out')
    .description('close the shift and print the run summary')
    .action(async () => {
      const r = await clockOut({ cwd, stateDir });
      io.out(
        [
          '── Shift closed ──',
          ` goal      : ${r.goal}`,
          ` branch    : ${r.branch}`,
          ` started   : ${r.started}`,
          ` ended     : ${r.ended}`,
          ` iterations: ${r.iterations}`,
          '',
        ].join('\n'),
      );
    });

  program
    .command('status')
    .description('print the current shift state and backlog counts (read-only)')
    .action(async () => {
      io.out(renderStatus(await status({ beads, stateDir })));
    });

  const launchTui = deps.launchTui ?? defaultLaunchTui;
  program
    .command('dashboard')
    .description('one-shot dashboard view; --watch launches the interactive TUI')
    .option('--watch', 'launch the live interactive TUI')
    .action(async (opts: { watch?: boolean }) => {
      if (opts.watch) {
        await launchTui();
        return;
      }
      const m = await getDashboardModel({ beads, stateDir });
      io.out(renderStatus(m));
      io.out(
        `progress:  ${m.progress.closed}/${m.progress.total} (${m.progress.pct}%)\n` +
          `ready:     ${m.ready.map((b) => b.id).join(', ') || '(none)'}\n` +
          `in_prog:   ${m.inProgress.map((b) => b.id).join(', ') || '(none)'}\n` +
          `blocked:   ${m.blocked.map((b) => b.id).join(', ') || '(none)'}\n`,
      );
    });

  program
    .command('run')
    .description('start a detached driver run')
    .option('--max-iterations <n>', 'cap on shift iterations (omit for uncapped)')
    .option('--backend <name>', 'claude | codex | api')
    .option('-K, --concurrency <n>', 'worker pool size')
    .action(async (opts: { maxIterations?: string; backend?: string; concurrency?: string }) => {
      const s = await status({ beads, stateDir });
      const backend =
        (opts.backend as 'claude' | 'codex' | 'api' | undefined) ?? effectiveBackend();
      const handle = await startRun(
        {
          maxIterations: opts.maxIterations ? Number(opts.maxIterations) : undefined,
          backend,
          concurrency: opts.concurrency ? Number(opts.concurrency) : undefined,
        },
        { stateDir, branch: s.state.branch || 'current' },
      );
      io.out(`run started — pid ${handle.pid}\njournal: ${handle.journalPath}\n`);
    });

  const config = program.command('config').description('get/set CLI config');
  config
    .command('get [key]')
    .description('print the config (or one key)')
    .action((key?: string) => {
      const cfg = readConfig();
      if (key) io.out(`${String((cfg as Record<string, unknown>)[key] ?? '')}\n`);
      else io.out(`${JSON.stringify(cfg, null, 2)}\n`);
    });
  config
    .command('set <key> <value>')
    .description('set a config key')
    .action((key: string, value: string) => {
      const cfg = setConfig(key, value);
      io.out(`${JSON.stringify(cfg, null, 2)}\n`);
    });

  program
    .command('doctor')
    .description('preflight node / bd / backend')
    .option('--backend <name>', 'claude | codex | api')
    .action(async (opts: { backend?: string }) => {
      const backend =
        (opts.backend as 'claude' | 'codex' | 'api' | undefined) ?? effectiveBackend();
      const report = await doctor({ backend });
      for (const c of report.checks) io.out(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}\n`);
      io.out(report.ok ? 'doctor: ok\n' : 'doctor: problems found\n');
    });

  return program;
}

/**
 * Parse and dispatch a CLI invocation. Returns the process exit code. With no
 * subcommand (or --help) it prints usage. The interactive TUI (bare invocation)
 * lands in Milestone B.
 */
export async function runCli(
  argv: string[],
  io: Io = stdio(),
  deps: CliDeps = {},
): Promise<number> {
  const program = buildProgram(io, deps);

  // Bare invocation: launch the interactive TUI. The launcher guards raw mode
  // and degrades to a plain StaticStatusDump off-TTY (it never crashes on a
  // pipe/CI and never shows a modal there).
  if (argv.length === 0) {
    const launchTui = deps.launchTui ?? defaultLaunchTui;
    await launchTui();
    return 0;
  }

  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version are surfaced as a clean exit-0 by commander.
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') return 0;
      if (err.code === 'commander.help') return 0;
      // Unknown command / bad option: commander has already written its error +
      // help to writeErr; map to a nonzero code.
      return err.exitCode || 1;
    }
    io.err(`error: ${(err as Error).message}\n`);
    return 1;
  }
}

/** Default stdout/stderr sink. */
function stdio(): Io {
  return {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  };
}
