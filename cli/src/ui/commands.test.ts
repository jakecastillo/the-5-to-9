import { expect, test, vi } from 'vitest';
import { resolveCommand } from './command-parse.ts';
import { COMMANDS, type CommandContext, commandNames, findCommand } from './commands.ts';

/** A fully-stubbed context that records every call. */
function mockCtx(): CommandContext {
  return {
    clockIn: vi.fn(),
    clockOut: vi.fn(),
    run: vi.fn(),
    status: vi.fn(),
    doctor: vi.fn(),
    configGet: vi.fn(),
    configSet: vi.fn(),
    gate: vi.fn(),
    filter: vi.fn(),
    follow: vi.fn(),
    clear: vi.fn(),
    help: vi.fn(),
    quit: vi.fn(),
    notify: vi.fn(),
  };
}

/** Resolve a line and run its handler against a fresh mock ctx. */
function dispatch(line: string): CommandContext {
  const r = resolveCommand(line);
  if (!r.ok) throw new Error(`unexpected parse failure for ${line}: ${r.error}`);
  const ctx = mockCtx();
  r.spec.run(ctx, r.parsed);
  return ctx;
}

test('the registry covers the full vocabulary', () => {
  const names = commandNames();
  for (const expected of [
    'clock-in',
    'clock-out',
    'run',
    'status',
    'doctor',
    'config',
    'gate',
    'help',
    'quit',
    'filter',
    'follow',
    'clear',
  ]) {
    expect(names).toContain(expected);
  }
});

test('every command has a summary and a unique name', () => {
  const seen = new Set<string>();
  for (const c of COMMANDS) {
    expect(c.summary.length).toBeGreaterThan(0);
    expect(seen.has(c.name)).toBe(false);
    seen.add(c.name);
  }
});

test('aliases resolve to the canonical command', () => {
  expect(findCommand('exit')?.name).toBe('quit');
  expect(findCommand('q')?.name).toBe('quit');
  expect(findCommand('?')?.name).toBe('help');
});

test('/clock-out invokes the facade clockOut', () => {
  expect(dispatch('/clock-out').clockOut).toHaveBeenCalledTimes(1);
});

test('/clock-in joins positional args into the goal', () => {
  const ctx = dispatch('/clock-in ship the thing');
  expect(ctx.clockIn).toHaveBeenCalledWith('ship the thing');
});

test('/run coerces --max-iterations to a number and passes backend', () => {
  const ctx = dispatch('/run --max-iterations 30 --backend codex');
  expect(ctx.run).toHaveBeenCalledWith({ maxIterations: 30, backend: 'codex' });
});

test('bare text via /filter forwards the query', () => {
  expect(dispatch('/filter add token').filter).toHaveBeenCalledWith('add token');
});

test('/quit calls quit; /follow toggles; /clear clears', () => {
  expect(dispatch('/quit').quit).toHaveBeenCalledTimes(1);
  expect(dispatch('/follow').follow).toHaveBeenCalledTimes(1);
  expect(dispatch('/clear').clear).toHaveBeenCalledTimes(1);
});
