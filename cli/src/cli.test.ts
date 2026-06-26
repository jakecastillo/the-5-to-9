/**
 * cli.test.ts — runCli is now TUI-only.
 *
 * Every argv route either:
 *   • prints a short info string (--version, --help) and returns 0, or
 *   • delegates to the injected launchTui (everything else, including bare).
 *
 * The subcommand layer (clock-in/clock-out/status/run/gate/config/doctor/dashboard)
 * is gone; those operations are tested directly in their own unit files.
 */
import { expect, test, vi } from 'vitest';
import { type CliDeps, runCli } from './cli.ts';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

function stubLaunch(): NonNullable<CliDeps['launchTui']> {
  return vi.fn(async () => {});
}

// ── TUI routing (bare + any args) ────────────────────────────────────────────

test('bare invocation → launchTui called exactly once, returns 0', async () => {
  const c = capture();
  const launchTui = stubLaunch();
  const code = await runCli([], c.io, { launchTui });
  expect(code).toBe(0);
  expect(launchTui).toHaveBeenCalledTimes(1);
});

test('any unrecognized args → launchTui called (not an error), returns 0', async () => {
  const c = capture();
  const launchTui = stubLaunch();
  const code = await runCli(['status'], c.io, { launchTui });
  expect(code).toBe(0);
  expect(launchTui).toHaveBeenCalledTimes(1);
});

test('multiple unrecognized args → launchTui called, returns 0', async () => {
  const c = capture();
  const launchTui = stubLaunch();
  const code = await runCli(['clock-in', 'ship', 'the', 'thing'], c.io, { launchTui });
  expect(code).toBe(0);
  expect(launchTui).toHaveBeenCalledTimes(1);
});

test('launchTui is the sole side-effect — no stdout/stderr noise on bare run', async () => {
  const c = capture();
  const launchTui = stubLaunch();
  await runCli([], c.io, { launchTui });
  // runCli itself must not write anything when delegating to the TUI
  expect(c.out()).toBe('');
  expect(c.err()).toBe('');
});

// ── --version ─────────────────────────────────────────────────────────────────

test('--version prints package version (semver), returns 0', async () => {
  const c = capture();
  const code = await runCli(['--version'], c.io, {});
  expect(code).toBe(0);
  expect(c.out().trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test('--version does not call launchTui', async () => {
  const launchTui = stubLaunch();
  const c = capture();
  await runCli(['--version'], c.io, { launchTui });
  expect(launchTui).not.toHaveBeenCalled();
});

// ── --help ────────────────────────────────────────────────────────────────────

test('--help prints TUI-only notice mentioning / for palette, returns 0', async () => {
  const c = capture();
  const code = await runCli(['--help'], c.io, {});
  expect(code).toBe(0);
  const text = c.out();
  // Must name itself as TUI-only
  expect(text).toMatch(/tui.only/i);
  // Must tell the user about the / command palette
  expect(text).toContain('/');
});

test('--help does not call launchTui', async () => {
  const launchTui = stubLaunch();
  const c = capture();
  await runCli(['--help'], c.io, { launchTui });
  expect(launchTui).not.toHaveBeenCalled();
});

test('-h is an alias for --help (returns 0, prints TUI notice)', async () => {
  const c = capture();
  const code = await runCli(['-h'], c.io, {});
  expect(code).toBe(0);
  expect(c.out()).toMatch(/tui.only/i);
});
