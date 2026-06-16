import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isHelpRequested, usage, validateBackend } from '../src/main.ts';

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
