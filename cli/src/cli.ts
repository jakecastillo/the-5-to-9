import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchTui as defaultLaunchTui } from './ui/launch.ts';

// Read the version from package.json at import time; avoids a hardcoded copy
// that drifts out of sync. Works both in the dist bundle and in vitest.
const _dir = dirname(fileURLToPath(import.meta.url));
const { version: PKG_VERSION } = JSON.parse(
  readFileSync(join(_dir, '..', 'package.json'), 'utf8'),
) as { version: string };

/** Output sink — defaults to process stdout/stderr. */
export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

/** Injection seam for the whole CLI. Only the TUI launcher is injected now;
 *  tests stub it to avoid rendering Ink. */
export interface CliDeps {
  /** Launch the interactive TUI (injectable so tests don't render Ink). */
  launchTui?: () => Promise<void>;
}

const HELP_TEXT = `the-5-to-9 is now TUI-only — just run \`the-5-to-9\`.
Drive everything from the in-app command bar:
  /          open the command palette (clock-in, clock-out, run, …)
  q / Ctrl-C quit (never kills a detached driver run)
`;

/**
 * Dispatch a CLI invocation. Returns the process exit code.
 *
 * Routes:
 *   --version / -V   → print the package version and exit 0.
 *   --help / -h      → print the TUI-only notice and exit 0.
 *   (everything else) → delegate to launchTui, which guards raw mode and
 *                       degrades to a plain StaticStatusDump off-TTY.
 */
export async function runCli(
  argv: string[],
  io: Io = stdio(),
  deps: CliDeps = {},
): Promise<number> {
  const launchTui = deps.launchTui ?? defaultLaunchTui;

  if (argv.includes('--version') || argv.includes('-V')) {
    io.out(`${PKG_VERSION}\n`);
    return 0;
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(HELP_TEXT);
    return 0;
  }

  // Bare invocation or any unrecognized arg: launch the TUI.
  // The launcher itself guards raw mode and degrades to StaticStatusDump off-TTY
  // (no modal, no crash, exit 0).
  await launchTui();
  return 0;
}

/** Default stdout/stderr sink. */
function stdio(): Io {
  return {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  };
}
