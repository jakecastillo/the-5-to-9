import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.ts';
import { isHelpRequested, parseArgv, usage, validateBackend } from '../src/main.ts';

test('usage lists the documented flags', () => {
  const u = usage();
  assert.match(u, /--backend claude\|codex\|api/);
  assert.match(u, /--goal/);
  assert.match(u, /--budget-usd/);
});

test('isHelpRequested detects --help and -h', () => {
  assert.equal(isHelpRequested(['--help']), true);
  assert.equal(isHelpRequested(['-h']), true);
  assert.equal(isHelpRequested(['--goal', 'g', '--help']), true);
  assert.equal(isHelpRequested(['--backend', 'claude']), false);
});

test('validateBackend accepts the three valid backends', () => {
  assert.equal(validateBackend('claude'), undefined);
  assert.equal(validateBackend('codex'), undefined);
  assert.equal(validateBackend('api'), undefined);
});

test('validateBackend returns a one-line error naming valid backends for unknown values', () => {
  const err = validateBackend('foo');
  assert.ok(err, 'expected an error message for an unknown backend');
  assert.equal(err?.includes('\n'), false, 'error must be a single line');
  assert.match(err as string, /foo/);
  assert.match(err as string, /claude/);
  assert.match(err as string, /codex/);
  assert.match(err as string, /api/);
});

test('validateBackend returns undefined when no backend was passed (resolveConfig owns that error)', () => {
  assert.equal(validateBackend(undefined), undefined);
});

// --- parseArgv: new flags (us4) ---

test('parseArgv reads --concurrency into concurrency', () => {
  const parsed = parseArgv(['--backend', 'api', '--concurrency', '4']);
  assert.equal((parsed as unknown as { concurrency?: number }).concurrency, 4);
});

test('parseArgv reads -K alias into concurrency', () => {
  const parsed = parseArgv(['--backend', 'api', '-K', '3']);
  assert.equal((parsed as unknown as { concurrency?: number }).concurrency, 3);
});

test('parseArgv reads --max-iterations into maxIterations', () => {
  const parsed = parseArgv(['--backend', 'claude', '--max-iterations', '10']);
  assert.equal(parsed.maxIterations, 10);
});

test('parseArgv reads --no-progress-window into noProgressWindow', () => {
  const parsed = parseArgv(['--backend', 'claude', '--no-progress-window', '5']);
  assert.equal(parsed.noProgressWindow, 5);
});

// --- usage() lists the new flags (us4) ---

test('usage lists --concurrency / -K', () => {
  const u = usage();
  assert.match(u, /--concurrency/);
  assert.match(u, /-K/);
});

test('usage lists --max-iterations', () => {
  assert.match(usage(), /--max-iterations/);
});

test('usage lists --no-progress-window', () => {
  assert.match(usage(), /--no-progress-window/);
});

// --- resolveConfig clamp end-to-end (us4) ---

test('resolveConfig clamps K=1 for codex backend even when --concurrency 3 is passed', () => {
  const parsed = parseArgv(['--backend', 'codex', '-K', '3']);
  const cfg = resolveConfig(parsed as unknown as import('../src/config.ts').RawArgs);
  assert.equal(cfg.concurrency, 1, 'codex must be serialized (K=1)');
});

test('resolveConfig honors --concurrency for api backend', () => {
  const parsed = parseArgv(['--backend', 'api', '-K', '3']);
  const cfg = resolveConfig(parsed as unknown as import('../src/config.ts').RawArgs);
  assert.equal(cfg.concurrency, 3, 'api backend should respect K=3');
});
