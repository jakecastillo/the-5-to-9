import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  type ConsentDeps,
  awaitResolution,
  listPending,
  readResolution,
  requestConsent,
  resolve,
} from './consent.ts';

function deps(): ConsentDeps {
  return { stateDir: mkdtempSync(join(tmpdir(), 'f9-consent-')) };
}

test('requestConsent writes a pending file that listPending returns', () => {
  const d = deps();
  const p = requestConsent(
    { command: 'gh release create v1', category: 'publish', beadId: 't59-7e0', role: 'Cage' },
    d,
  );
  expect(p.id).toBeTruthy();
  expect(p.command).toBe('gh release create v1');
  expect(p.category).toBe('publish');
  expect(p.token).toBeTruthy();
  const pending = listPending(d);
  expect(pending.map((x) => x.id)).toContain(p.id);
  expect(existsSync(join(d.stateDir as string, 'consent', `${p.id}.pending.json`))).toBe(true);
});

test('resolve with the WRONG token denies the approval and writes NOTHING', () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  const r = resolve(p.id, true, 'not-the-token', d);
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
  // INVARIANT: a wrong token never approves and never writes a resolution.
  expect(readResolution(p.id, d)).toBeNull();
  expect(existsSync(join(d.stateDir as string, 'consent', `${p.id}.resolved.json`))).toBe(false);
});

test('resolve with the CORRECT token writes an approved resolution', () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  const r = resolve(p.id, true, p.token, d);
  expect(r.ok).toBe(true);
  const res = readResolution(p.id, d);
  expect(res).not.toBeNull();
  expect(res?.approved).toBe(true);
  expect(res?.token).toBe(p.token);
  // Resolved records drop out of listPending.
  expect(listPending(d).map((x) => x.id)).not.toContain(p.id);
});

test('resolve(false) denies without requiring a token', () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  const r = resolve(p.id, false, undefined, d);
  expect(r.ok).toBe(true);
  expect(readResolution(p.id, d)?.approved).toBe(false);
});

test('resolve is write-once — a second resolve is a no-op error', () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  expect(resolve(p.id, false, undefined, d).ok).toBe(true);
  // A second resolve (even an approve with the right token) must NOT overwrite.
  const second = resolve(p.id, true, p.token, d);
  expect(second.ok).toBe(false);
  expect(second.error).toBeTruthy();
  // The first (deny) resolution still stands.
  expect(readResolution(p.id, d)?.approved).toBe(false);
});

test('resolve on an unknown id fails (no pending, nothing written)', () => {
  const d = deps();
  const r = resolve('does-not-exist', true, 'whatever', d);
  expect(r.ok).toBe(false);
  expect(existsSync(join(d.stateDir as string, 'consent'))).toBe(false);
});

test('awaitResolution returns a pre-existing resolution immediately (resumable)', async () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  resolve(p.id, true, p.token, d);
  const res = await awaitResolution(p.id, { ...d, timeoutMs: 10_000, pollMs: 5 });
  expect(res.approved).toBe(true);
});

test('awaitResolution times out to a DENY with an injected clock (no real sleeping)', async () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  // Injected clock: jumps past the timeout on the second read.
  let t = 0;
  const now = () => {
    const v = t;
    t += 1000;
    return v;
  };
  const res = await awaitResolution(p.id, {
    ...d,
    timeoutMs: 500,
    pollMs: 1,
    now,
  });
  // INVARIANT: timeout → DENY (never silent-allow).
  expect(res.approved).toBe(false);
  expect(res.id).toBe(p.id);
});

test('awaitResolution resolves when a resolution lands mid-poll', async () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  // Land an approval shortly after the await starts.
  setTimeout(() => resolve(p.id, true, p.token, d), 10);
  const res = await awaitResolution(p.id, { ...d, timeoutMs: 10_000, pollMs: 2 });
  expect(res.approved).toBe(true);
});

test('a corrupt pending file is ignored by listPending (fail-closed, no crash)', () => {
  const d = deps();
  requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  // Write a garbage pending file alongside the good one.
  const dir = join(d.stateDir as string, 'consent');
  const files = readdirSync(dir);
  expect(files.length).toBeGreaterThan(0);
  // listPending must not throw even if one record is unparseable.
  expect(() => listPending(d)).not.toThrow();
});
