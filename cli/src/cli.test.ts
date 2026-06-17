import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { BeadsRead } from './beads-read.ts';
import { type CliDeps, runCli } from './cli.ts';
import { readResolution, requestConsent } from './consent.ts';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

function stubBeads(): BeadsRead {
  return {
    available: () => true,
    ready: () => Promise.resolve([{ id: 'r1', title: 'Ready one' }]),
    list: () => Promise.resolve([]),
    count: (s) => Promise.resolve(s === 'closed' ? 5 : 0),
    readyCount: () => Promise.resolve(1),
  };
}

function deps(repo: string): CliDeps {
  return {
    beads: stubBeads(),
    stateDir: join(repo, '.claude', 'five-to-nine'),
    cwd: repo,
  };
}

test('status prints goal/branch/iteration/gate + counts, returns 0', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  // open a shift first (no branch — temp dir is not a repo)
  await runCli(['clock-in', 'ship X', '--no-branch'], c.io, deps(repo));
  const c2 = capture();
  const code = await runCli(['status'], c2.io, deps(repo));
  expect(code).toBe(0);
  const text = c2.out();
  expect(text).toContain('ship X'); // goal
  expect(text).toMatch(/ready/i);
  expect(text).toMatch(/closed/i);
});

test('clock-in writes state', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const code = await runCli(['clock-in', 'ship the thing', '--no-branch'], c.io, deps(repo));
  expect(code).toBe(0);
  expect(existsSync(join(repo, '.claude/five-to-nine/shift.local.md'))).toBe(true);
});

test('--help lists subcommands and returns 0 without side effects', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const code = await runCli(['--help'], c.io, deps(repo));
  expect(code).toBe(0);
  const text = c.out();
  for (const sub of ['clock-in', 'clock-out', 'status', 'run', 'dashboard', 'config', 'doctor']) {
    expect(text).toContain(sub);
  }
  expect(existsSync(join(repo, '.claude/five-to-nine/shift.local.md'))).toBe(false);
});

test('unknown subcommand → nonzero + usage to stderr', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const code = await runCli(['bogus-cmd'], c.io, deps(repo));
  expect(code).not.toBe(0);
  expect(c.err().length).toBeGreaterThan(0);
});

test('bare invocation launches the TUI (via the injected launcher)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const launchTui = vi.fn(async () => {});
  const code = await runCli([], c.io, { ...deps(repo), launchTui });
  expect(code).toBe(0);
  expect(launchTui).toHaveBeenCalledTimes(1);
});

test('bare invocation in a non-TTY uses the dump path (launcher decides), returns 0', async () => {
  // The launcher itself guards raw mode; from runCli's view it is called once
  // and returns 0. (The StaticStatusDump fallback lives inside launchTui.)
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const launchTui = vi.fn(async () => {});
  const code = await runCli([], c.io, { ...deps(repo), launchTui });
  expect(code).toBe(0);
  expect(launchTui).toHaveBeenCalled();
});

test('dashboard --watch resolves to the TUI launcher', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const launchTui = vi.fn(async () => {});
  const code = await runCli(['dashboard', '--watch'], c.io, { ...deps(repo), launchTui });
  expect(code).toBe(0);
  expect(launchTui).toHaveBeenCalledTimes(1);
});

test('dashboard without --watch stays a one-shot text render (no TUI)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  await runCli(['clock-in', 'ship X', '--no-branch'], capture().io, deps(repo));
  const c = capture();
  const launchTui = vi.fn(async () => {});
  const code = await runCli(['dashboard'], c.io, { ...deps(repo), launchTui });
  expect(code).toBe(0);
  expect(launchTui).not.toHaveBeenCalled();
  expect(c.out()).toMatch(/progress|ready/i);
});

// ── run subcommand: numeric arg validation (P1-B audit fix) ──────────────────

test('run --max-iterations abc → nonzero, clear error naming the flag, driver NOT spawned', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const startRun = vi.fn(async () => ({ pid: 1, journalPath: 'x', detached: true as const }));
  const code = await runCli(['run', '--backend', 'claude', '--max-iterations', 'abc'], c.io, {
    ...deps(repo),
    startRun,
  });
  expect(code).not.toBe(0);
  expect(c.err()).toMatch(/max-iterations/i);
  // INVARIANT: a NaN must never reach the driver.
  expect(startRun).not.toHaveBeenCalled();
});

test('run --concurrency xyz → nonzero, clear error naming the flag, driver NOT spawned', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const startRun = vi.fn(async () => ({ pid: 1, journalPath: 'x', detached: true as const }));
  const code = await runCli(['run', '--backend', 'claude', '--concurrency', 'xyz'], c.io, {
    ...deps(repo),
    startRun,
  });
  expect(code).not.toBe(0);
  expect(c.err()).toMatch(/concurrency/i);
  expect(startRun).not.toHaveBeenCalled();
});

test('run --concurrency 0 → nonzero (must be a positive integer), driver NOT spawned', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const startRun = vi.fn(async () => ({ pid: 1, journalPath: 'x', detached: true as const }));
  const code = await runCli(['run', '--backend', 'claude', '--concurrency', '0'], c.io, {
    ...deps(repo),
    startRun,
  });
  expect(code).not.toBe(0);
  expect(c.err()).toMatch(/concurrency/i);
  expect(startRun).not.toHaveBeenCalled();
});

test('run with a valid integer --max-iterations still starts (driver spawned with the number)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  await runCli(['clock-in', 'ship X', '--no-branch'], capture().io, deps(repo));
  const c = capture();
  const startRun: NonNullable<CliDeps['startRun']> = vi.fn(async () => ({
    pid: 42,
    journalPath: 'j',
    detached: true as const,
  }));
  const code = await runCli(
    ['run', '--backend', 'claude', '--max-iterations', '5', '--concurrency', '2'],
    c.io,
    { ...deps(repo), startRun },
  );
  expect(code).toBe(0);
  expect(startRun).toHaveBeenCalledTimes(1);
  const optsArg = vi.mocked(startRun).mock.calls[0][0];
  expect(optsArg.maxIterations).toBe(5);
  expect(optsArg.concurrency).toBe(2);
});

// ── gate subcommand (scriptable, non-TTY consent) ────────────────────────────

function stateDirOf(repo: string): string {
  return join(repo, '.claude', 'five-to-nine');
}

test('gate pending lists a pending record (id, command, category, token)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const p = requestConsent(
    { command: 'gh release create v1', category: 'publish' },
    { stateDir: stateDirOf(repo) },
  );
  const c = capture();
  const code = await runCli(['gate', 'pending'], c.io, deps(repo));
  expect(code).toBe(0);
  const text = c.out();
  expect(text).toContain(p.id);
  expect(text).toContain('gh release create v1');
  expect(text).toMatch(/publish/);
  expect(text).toContain(p.token);
});

test('gate pending with nothing pending says so, returns 0', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const c = capture();
  const code = await runCli(['gate', 'pending'], c.io, deps(repo));
  expect(code).toBe(0);
  expect(c.out()).toMatch(/no pending|none/i);
});

test('gate approve with the WRONG token → nonzero, no approval written', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const p = requestConsent(
    { command: 'deploy prod', category: 'deploy' },
    { stateDir: stateDirOf(repo) },
  );
  const c = capture();
  const code = await runCli(['gate', 'approve', p.id, '--token', 'WRONG'], c.io, deps(repo));
  expect(code).not.toBe(0);
  expect(c.err().length).toBeGreaterThan(0);
  // INVARIANT: a wrong token never approves and never writes a resolution.
  expect(readResolution(p.id, { stateDir: stateDirOf(repo) })).toBeNull();
});

test('gate approve with a MISSING token → nonzero, no approval written', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const p = requestConsent(
    { command: 'deploy prod', category: 'deploy' },
    { stateDir: stateDirOf(repo) },
  );
  const c = capture();
  const code = await runCli(['gate', 'approve', p.id], c.io, deps(repo));
  expect(code).not.toBe(0);
  expect(readResolution(p.id, { stateDir: stateDirOf(repo) })).toBeNull();
});

test('gate approve with the CORRECT token → 0, approved resolution written', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const p = requestConsent(
    { command: 'deploy prod', category: 'deploy' },
    { stateDir: stateDirOf(repo) },
  );
  const c = capture();
  const code = await runCli(['gate', 'approve', p.id, '--token', p.token], c.io, deps(repo));
  expect(code).toBe(0);
  expect(readResolution(p.id, { stateDir: stateDirOf(repo) })?.approved).toBe(true);
});

test('gate deny → 0, denied resolution written', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-cli-'));
  const p = requestConsent(
    { command: 'deploy prod', category: 'deploy' },
    { stateDir: stateDirOf(repo) },
  );
  const c = capture();
  const code = await runCli(['gate', 'deny', p.id], c.io, deps(repo));
  expect(code).toBe(0);
  expect(readResolution(p.id, { stateDir: stateDirOf(repo) })?.approved).toBe(false);
});
