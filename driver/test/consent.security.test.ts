// Adversarial regression tests for the Phase-1b consent gate — the four defects
// the Eye in the Sky found (F1 write-once TOCTOU, F2 path traversal, F3 degenerate
// pending token, F4 non-boolean approved). Each test FAILS on the pre-fix code.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ConsentDeps, readResolution, requestConsent, resolve } from '../src/consent.ts';

function freshDeps(): ConsentDeps {
  return { stateDir: mkdtempSync(join(tmpdir(), 'f9-consent-sec-')) };
}
function consentDir(d: ConsentDeps): string {
  const dir = join(d.stateDir as string, 'consent');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── F2: path traversal in `id` ───────────────────────────────────────────────
test('F2: resolve refuses a path-traversal id and writes nothing outside the consent dir', () => {
  const d = freshDeps();
  consentDir(d);
  const r = resolve('../../pwn', true, 'x', d);
  assert.equal(r.ok, false);
  assert.equal(existsSync(join(d.stateDir as string, 'pwn.resolved.json')), false);
  assert.equal(existsSync(join(d.stateDir as string, '..', 'pwn.resolved.json')), false);
});

test('F2: readResolution returns null for unsafe ids', () => {
  const d = freshDeps();
  assert.equal(readResolution('../../etc/passwd', d), null);
  assert.equal(readResolution('a/b', d), null);
  assert.equal(readResolution('..', d), null);
});

// ── F3: degenerate (empty/missing) pending token is unapprovable ──────────────
test('F3: a pending with an EMPTY token cannot be approved (no "" === "")', () => {
  const d = freshDeps();
  const dir = consentDir(d);
  const id = 'craft-empty-token';
  writeFileSync(
    join(dir, `${id}.pending.json`),
    JSON.stringify({
      id,
      command: 'deploy',
      category: 'deploy',
      beadId: null,
      role: null,
      token: '',
      createdAt: 'x',
    }),
  );
  assert.equal(resolve(id, true, '', d).ok, false);
  assert.equal(readResolution(id, d), null);
});

test('F3: a pending with a MISSING token field cannot be approved', () => {
  const d = freshDeps();
  const dir = consentDir(d);
  const id = 'craft-no-token';
  writeFileSync(
    join(dir, `${id}.pending.json`),
    JSON.stringify({
      id,
      command: 'deploy',
      category: 'deploy',
      beadId: null,
      role: null,
      createdAt: 'x',
    }),
  );
  assert.equal(resolve(id, true, undefined, d).ok, false);
  assert.equal(readResolution(id, d), null);
});

// ── F4: non-boolean `approved` must never read as an approval ─────────────────
test('F4: readResolution ignores a non-boolean approved (e.g. the string "yes")', () => {
  const d = freshDeps();
  const dir = consentDir(d);
  const id = 'craft-truthy';
  writeFileSync(
    join(dir, `${id}.resolved.json`),
    JSON.stringify({ id, approved: 'yes', token: 'x', resolvedAt: 'x' }),
  );
  assert.equal(readResolution(id, d), null);
});

// ── F1: write-once — a deny cannot be clobbered by a later approve ────────────
test('F1: write-once — a deny is NOT overwritten by a later approve', () => {
  const d = freshDeps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  assert.equal(resolve(p.id, false, undefined, d).ok, true); // deny wins first
  const second = resolve(p.id, true, p.token, d); // racing approve
  assert.equal(second.ok, false); // refused (write-once)
  assert.equal(readResolution(p.id, d)?.approved, false); // still denied
});

// ── Finding A: the confirm token binds to the EXACT command ───────────────────
test('Finding A: the token is command-bound — same verb, different command → different token', () => {
  const d = freshDeps();
  const a = requestConsent({ command: 'npm publish', category: 'publish' }, d);
  const b = requestConsent({ command: 'npm publish && rm -rf ~', category: 'publish' }, d);
  // Both start with the verb, but the fingerprint differs, so the tokens differ —
  // typing the benign command's token can never approve the chained-payload one.
  assert.notEqual(a.token, b.token);
  assert.match(a.token, /^npm-[0-9a-f]{6}$/);
  // The chained payload's pending cannot be approved with the plain verb.
  assert.equal(resolve(b.id, true, 'npm', d).ok, false);
  assert.equal(readResolution(b.id, d), null);
});
