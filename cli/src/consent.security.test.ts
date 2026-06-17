// Adversarial regression tests for the Phase-1b consent gate — the four defects
// the Eye in the Sky found (F1 write-once TOCTOU, F2 path traversal, F3 degenerate
// pending token, F4 non-boolean approved). Each test FAILS on the pre-fix code.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { type ConsentDeps, readResolution, requestConsent, resolve } from './consent.ts';

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
  expect(r.ok).toBe(false);
  expect(existsSync(join(d.stateDir as string, 'pwn.resolved.json'))).toBe(false);
  expect(existsSync(join(d.stateDir as string, '..', 'pwn.resolved.json'))).toBe(false);
});

test('F2: readResolution returns null for unsafe ids', () => {
  const d = freshDeps();
  expect(readResolution('../../etc/passwd', d)).toBeNull();
  expect(readResolution('a/b', d)).toBeNull();
  expect(readResolution('..', d)).toBeNull();
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
  expect(resolve(id, true, '', d).ok).toBe(false);
  expect(readResolution(id, d)).toBeNull();
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
  expect(resolve(id, true, undefined, d).ok).toBe(false);
  expect(readResolution(id, d)).toBeNull();
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
  expect(readResolution(id, d)).toBeNull();
});

// ── F1: write-once — a deny cannot be clobbered by a later approve ────────────
test('F1: write-once — a deny is NOT overwritten by a later approve', () => {
  const d = freshDeps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  expect(resolve(p.id, false, undefined, d).ok).toBe(true); // deny wins first
  const second = resolve(p.id, true, p.token, d); // racing approve
  expect(second.ok).toBe(false); // refused (write-once)
  expect(readResolution(p.id, d)?.approved).toBe(false); // still denied
});
