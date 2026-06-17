#!/usr/bin/env node
// the-5-to-9 CLI entrypoint. Dispatches to the commander program and maps the
// returned exit code onto the process. (Milestone B will render the Ink TUI here
// for a bare invocation; for now bare invocation prints usage.)
import { runCli } from './cli.ts';

process.exit(await runCli(process.argv.slice(2)));
