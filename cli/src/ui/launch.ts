import { render } from 'ink';
import { createElement } from 'react';
import { getDashboardModel } from '../operations/dashboard-model.ts';
import { App } from './App.tsx';
import { StaticStatusDump } from './StaticStatusDump.tsx';

// NOTE (B1 API spike): Ink 5.2's `render(tree, options)` has NO `altScreen` /
// `alternateScreen` option (verified against node_modules/ink/readme.md — only
// `stdout`, `stdin`, `exitOnCtrlC`, `patchConsole`, `debug` exist). The plan
// assumed Ink 7's `altScreen`. So we drive the alternate-screen buffer with the
// terminal escape sequences ourselves and restore it deterministically on exit,
// which also satisfies the spec's "leave the alt-screen so the report prints to
// normal scrollback" requirement.
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_LEAVE = '\x1b[?1049l';

export interface LaunchOpts {
  /** Output stream (defaults to process.stdout). */
  stdout?: NodeJS.WriteStream;
  /** Input stream (defaults to process.stdin). */
  stdin?: NodeJS.ReadStream;
  /** Override the raw-mode probe (tests inject false to force the dump). */
  rawModeSupported?: boolean;
  /** Use the alternate screen buffer (default true; disabled in tests). */
  useAltScreen?: boolean;
}

/** Probe whether the given stdin supports raw mode (interactive TTY). */
function probeRawMode(stdin: NodeJS.ReadStream): boolean {
  // setRawMode is only present on a real TTY; isRawModeSupported mirrors what
  // Ink's useStdin() exposes at render time.
  return typeof stdin.setRawMode === 'function' && stdin.isTTY === true;
}

/**
 * Launch the interactive TUI. Guards raw mode: on a pipe/CI stdin it prints a
 * plain status dump (StaticStatusDump) and returns without entering the
 * interactive layout or any modal. Quitting NEVER kills a detached driver run.
 */
export async function launchTui(opts: LaunchOpts = {}): Promise<void> {
  const stdout = opts.stdout ?? process.stdout;
  const stdin = opts.stdin ?? process.stdin;
  const rawModeSupported = opts.rawModeSupported ?? probeRawMode(stdin);

  // Read an initial model once so the first frame is populated (the poll takes
  // over after mount inside the interactive App).
  let model = null;
  try {
    model = await getDashboardModel();
  } catch {
    model = null;
  }

  if (!rawModeSupported) {
    // Non-TTY fallback: a single plain render, no alt-screen, no modal.
    const { unmount, waitUntilExit } = render(createElement(StaticStatusDump, { model }), {
      stdout,
      stdin,
      patchConsole: false,
    });
    unmount();
    await waitUntilExit();
    return;
  }

  const useAltScreen = opts.useAltScreen ?? true;
  if (useAltScreen) stdout.write(ALT_SCREEN_ENTER);

  const { waitUntilExit } = render(
    createElement(App, { initial: { model }, rawModeSupported: true }),
    { stdout, stdin, exitOnCtrlC: false },
  );

  try {
    await waitUntilExit();
  } finally {
    // Deterministic restore: leave the alternate screen so the shift report
    // prints into normal scrollback. Always runs, even on error.
    if (useAltScreen) stdout.write(ALT_SCREEN_LEAVE);
  }
}
