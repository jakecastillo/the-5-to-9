import { expect, test } from 'vitest';
import { parseCommandLine, resolveCommand } from './command-parse.ts';

test('parses a verb with a long flag and value', () => {
  expect(parseCommandLine('/run --max-iterations 30')).toEqual({
    name: 'run',
    args: [],
    flags: { maxIterations: '30' },
  });
});

test('leading slash is optional; --flag=value and short -K both parse', () => {
  expect(parseCommandLine('run --max-iterations=30 -K 2')).toEqual({
    name: 'run',
    args: [],
    flags: { maxIterations: '30', K: '2' },
  });
});

test('kebab flag names are camelCased', () => {
  expect(parseCommandLine('/run --backend codex').flags).toEqual({ backend: 'codex' });
});

test('a flag with no value (or followed by another flag) is boolean true', () => {
  expect(parseCommandLine('/dashboard --watch').flags).toEqual({ watch: true });
});

test('positional args are preserved in order (free-text goal)', () => {
  expect(parseCommandLine('/clock-in ship the thing')).toEqual({
    name: 'clock-in',
    args: ['ship', 'the', 'thing'],
    flags: {},
  });
});

test('resolveCommand resolves a known verb to its spec', () => {
  const r = resolveCommand('/run --max-iterations 30');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.spec.name).toBe('run');
    expect(r.parsed.flags).toEqual({ maxIterations: '30' });
  }
});

test('resolveCommand resolves an alias to the canonical spec', () => {
  const r = resolveCommand('/exit');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.spec.name).toBe('quit');
});

test('resolveCommand rejects an unknown verb with a did-you-mean suggestion', () => {
  const r = resolveCommand('/rnu');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.suggestion).toBe('run');
});
