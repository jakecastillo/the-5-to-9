import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConfig, scrubbedEnv } from '../src/config.ts';

test('rejects an unconfirmed credential mode', () => {
  assert.throws(() => resolveConfig({ backend: undefined, goal: 'g' }), /credential mode/i);
});

test('defaults to subscription-first serialized (K=1) for claude/codex', () => {
  const c = resolveConfig({ backend: 'codex', goal: 'g' });
  assert.equal(c.concurrency, 1);
  assert.equal(c.credentialMode, 'subscription');
});

test('scrubbedEnv removes ANTHROPIC_API_KEY unless the api backend is chosen', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-x', PATH: '/bin' };
  assert.equal(scrubbedEnv('codex', env).ANTHROPIC_API_KEY, undefined);
  assert.equal(scrubbedEnv('api', env).ANTHROPIC_API_KEY, 'sk-x');
});

test('budget banner names backend + mode + caps', () => {
  const c = resolveConfig({ backend: 'codex', goal: 'g', budgetUsd: 5 });
  assert.match(c.banner, /codex/);
  assert.match(c.banner, /subscription/);
  assert.match(c.banner, /\$5/);
});

test('api backend allows K>1 (true parallel pool)', () => {
  const c = resolveConfig({ backend: 'api', goal: 'g', concurrency: 3 });
  assert.equal(c.concurrency, 3);
  assert.equal(c.credentialMode, 'metered-api');
});
