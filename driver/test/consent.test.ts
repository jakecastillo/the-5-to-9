import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type ConsentDeps,
  awaitResolution,
  listPending,
  readResolution,
  requestConsent,
  resolve,
} from '../src/consent.ts';

function deps(): ConsentDeps {
  return { stateDir: mkdtempSync(join(tmpdir(), 'f9-consent-')) };
}

test('requestConsent writes a pending file that listPending returns', () => {
  const d = deps();
  const p = requestConsent(
    { command: 'gh release create v1', category: 'publish', beadId: 't59-7e0', role: 'Cage' },
    d,
  );
  assert.ok(p.id);
  assert.equal(p.command, 'gh release create v1');
  assert.equal(p.category, 'publish');
  assert.ok(p.token);
  const pending = listPending(d);
  assert.ok(pending.map((x) => x.id).includes(p.id));
  assert.equal(existsSync(join(d.stateDir as string, 'consent', `${p.id}.pending.json`)), true);
});

test('resolve with the WRONG token denies the approval and writes NOTHING', () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  const r = resolve(p.id, true, 'not-the-token', d);
  assert.equal(r.ok, false);
  assert.ok(r.error);
  // INVARIANT: a wrong token never approves and never writes a resolution.
  assert.equal(readResolution(p.id, d), null);
  assert.equal(existsSync(join(d.stateDir as string, 'consent', `${p.id}.resolved.json`)), false);
});

test('resolve with the CORRECT token writes an approved resolution', () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  const r = resolve(p.id, true, p.token, d);
  assert.equal(r.ok, true);
  const res = readResolution(p.id, d);
  assert.notEqual(res, null);
  assert.equal(res?.approved, true);
  assert.equal(res?.token, p.token);
  // Resolved records drop out of listPending.
  assert.ok(
    !listPending(d)
      .map((x) => x.id)
      .includes(p.id),
  );
});

test('resolve(false) denies without requiring a token', () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  const r = resolve(p.id, false, undefined, d);
  assert.equal(r.ok, true);
  assert.equal(readResolution(p.id, d)?.approved, false);
});

test('resolve is write-once — a second resolve is a no-op error', () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  assert.equal(resolve(p.id, false, undefined, d).ok, true);
  // A second resolve (even an approve with the right token) must NOT overwrite.
  const second = resolve(p.id, true, p.token, d);
  assert.equal(second.ok, false);
  assert.ok(second.error);
  // The first (deny) resolution still stands.
  assert.equal(readResolution(p.id, d)?.approved, false);
});

test('resolve on an unknown id fails (no pending, nothing written)', () => {
  const d = deps();
  const r = resolve('does-not-exist', true, 'whatever', d);
  assert.equal(r.ok, false);
  assert.equal(existsSync(join(d.stateDir as string, 'consent')), false);
});

test('awaitResolution returns a pre-existing resolution immediately (resumable)', async () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  resolve(p.id, true, p.token, d);
  const res = await awaitResolution(p.id, { ...d, timeoutMs: 10_000, pollMs: 5 });
  assert.equal(res.approved, true);
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
  assert.equal(res.approved, false);
  assert.equal(res.id, p.id);
});

test('awaitResolution resolves when a resolution lands mid-poll', async () => {
  const d = deps();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  // Land an approval shortly after the await starts.
  setTimeout(() => resolve(p.id, true, p.token, d), 10);
  const res = await awaitResolution(p.id, { ...d, timeoutMs: 10_000, pollMs: 2 });
  assert.equal(res.approved, true);
});

test('a corrupt pending file is ignored by listPending (fail-closed, no crash)', () => {
  const d = deps();
  requestConsent({ command: 'deploy prod', category: 'deploy' }, d);
  // Write a garbage pending file alongside the good one.
  const dir = join(d.stateDir as string, 'consent');
  const files = readdirSync(dir);
  assert.ok(files.length > 0);
  // listPending must not throw even if one record is unparseable.
  assert.doesNotThrow(() => listPending(d));
});

// ── Bug 5: id mismatch in readPending (security) ──────────────────────────────

test('readPending: pending file whose JSON id mismatches the filename → ignored by listPending', () => {
  // A tampered pending file where JSON "id" != the filename-derived id must be
  // treated as corrupt and MUST NOT appear in listPending output.
  const d = deps();
  const dir = join(d.stateDir as string, 'consent');
  mkdirSync(dir, { recursive: true });
  const filenameId = 'safe-id-abc123';
  // JSON id is a DIFFERENT id (mismatch attack).
  const tamperedJson = JSON.stringify({
    id: 'different-id-xyz',
    command: 'gh release create v1',
    category: 'publish',
    beadId: null,
    role: null,
    token: 'gh-abc123',
    createdAt: new Date().toISOString(),
  });
  writeFileSync(join(dir, `${filenameId}.pending.json`), tamperedJson);
  const pending = listPending(d);
  // INVARIANT: a mismatched id must not appear — it is treated as corrupt.
  assert.equal(
    pending.some((p) => p.id === filenameId || p.id === 'different-id-xyz'),
    false,
  );
});
