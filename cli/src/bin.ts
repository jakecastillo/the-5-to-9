#!/usr/bin/env node
// the-5-to-9 CLI entrypoint. Launches the Ink TUI and maps the exit code onto
// the process. Every invocation (bare or any args) enters the TUI; a non-TTY
// degrades to a plain status dump.
import { runCli } from './cli.ts';

// Use an explicit .then(process.exit) rather than a top-level `await` so Node
// doesn't warn about an "unsettled top-level await" when Ink's render briefly
// holds the event loop on a non-TTY dump.
runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
