import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { requestConsent } from '../consent.ts';
import { gatePending } from './gate.ts';

function stateDir(): string {
  return mkdtempSync(join(tmpdir(), 'f9-gate-ops-'));
}

// ── Bug 5: gate id validation (SECURITY-SENSITIVE) ───────────────────────────

test('gatePending skips pending records whose id contains path-hostile chars', () => {
  // Defense-in-depth: gate.ts filters listPending output to ids matching the
  // safe-id pattern. Even if a record somehow slips through consent's own
  // isSafeId guard, gatePending must not surface it.
  const dir = stateDir();
  const consentDir = join(dir, 'consent');
  mkdirSync(consentDir, { recursive: true });

  // Write a pending file with a filename-id that looks safe but whose JSON id
  // contains a path-hostile fragment. gate.ts must not surface it.
  const filenameId = 'safe-filename-id';
  const maliciousPayload = JSON.stringify({
    id: '../etc/passwd', // JSON id mismatches the filename-derived id
    command: 'gh release create evil',
    category: 'publish',
    beadId: null,
    role: null,
    token: 'gh-abc000',
    createdAt: new Date().toISOString(),
  });
  writeFileSync(join(consentDir, `${filenameId}.pending.json`), maliciousPayload);

  const result = gatePending({ stateDir: dir });
  // INVARIANT: neither the filename-id nor the malicious JSON id must appear.
  expect(result.message).not.toContain(filenameId);
  expect(result.message).not.toContain('../etc/passwd');
  expect(result.message).not.toContain('gh release create evil');
});

test('gatePending lists a legitimate pending record (safe id, matched JSON id)', () => {
  // Baseline: a well-formed consent record must still appear.
  const dir = stateDir();
  const p = requestConsent(
    { command: 'gh release create v1', category: 'publish' },
    { stateDir: dir },
  );
  const result = gatePending({ stateDir: dir });
  expect(result.ok).toBe(true);
  expect(result.message).toContain(p.id);
  expect(result.message).toContain('gh release create v1');
});

// ── Bug wdb: gateApprove + gateDeny coverage (previously only via cli.test.ts) ─

import { readResolution } from '../consent.ts';
import { gateApprove, gateDeny } from './gate.ts';

test('gateApprove with a WRONG token → {ok:false}, no approval written (fail-closed)', () => {
  const dir = stateDir();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, { stateDir: dir });
  const r = gateApprove(p.id, 'WRONG_TOKEN', { stateDir: dir });
  expect(r.ok).toBe(false);
  // INVARIANT: a wrong token must never approve and must never write a resolution.
  expect(readResolution(p.id, { stateDir: dir })).toBeNull();
});

test('gateApprove with a MISSING (undefined) token → {ok:false}, no approval written', () => {
  const dir = stateDir();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, { stateDir: dir });
  const r = gateApprove(p.id, undefined, { stateDir: dir });
  expect(r.ok).toBe(false);
  expect(readResolution(p.id, { stateDir: dir })).toBeNull();
});

test('gateApprove with an EMPTY token → {ok:false}, no approval written', () => {
  const dir = stateDir();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, { stateDir: dir });
  const r = gateApprove(p.id, '', { stateDir: dir });
  expect(r.ok).toBe(false);
  expect(readResolution(p.id, { stateDir: dir })).toBeNull();
});

test('gateApprove with the CORRECT token → {ok:true}, approved resolution written', () => {
  const dir = stateDir();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, { stateDir: dir });
  const r = gateApprove(p.id, p.token, { stateDir: dir });
  expect(r.ok).toBe(true);
  expect(readResolution(p.id, { stateDir: dir })?.approved).toBe(true);
});

test('gateDeny → {ok:true}, denied resolution written', () => {
  const dir = stateDir();
  const p = requestConsent({ command: 'deploy prod', category: 'deploy' }, { stateDir: dir });
  const r = gateDeny(p.id, { stateDir: dir });
  expect(r.ok).toBe(true);
  expect(readResolution(p.id, { stateDir: dir })?.approved).toBe(false);
});
