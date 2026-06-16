import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BD_WRITE_DENY, IRREVERSIBLE_DENY } from '../src/adapters/adapter.ts';
import type { Bead } from '../src/types.ts';
import { specFor } from '../src/worker-spec.ts';

const STUB_BEAD: Bead = { id: 'b76', status: 'ready' };
const WORKTREE = '/tmp/wt-b76';

// Invariant 1: every BD_WRITE_DENY entry appears in every role's disallowedTools
test('dealer spec disallowedTools contains every BD_WRITE_DENY entry', () => {
  const spec = specFor(STUB_BEAD, 'dealer', WORKTREE);
  for (const rule of BD_WRITE_DENY) {
    assert.ok(
      spec.disallowedTools.includes(rule),
      `dealer spec missing BD_WRITE_DENY rule: ${rule}`,
    );
  }
});

test('auditor spec disallowedTools contains every BD_WRITE_DENY entry', () => {
  const spec = specFor(STUB_BEAD, 'auditor', WORKTREE);
  for (const rule of BD_WRITE_DENY) {
    assert.ok(
      spec.disallowedTools.includes(rule),
      `auditor spec missing BD_WRITE_DENY rule: ${rule}`,
    );
  }
});

// Invariant 2: every IRREVERSIBLE_DENY entry appears in every role's disallowedTools
test('dealer spec disallowedTools contains every IRREVERSIBLE_DENY entry', () => {
  const spec = specFor(STUB_BEAD, 'dealer', WORKTREE);
  for (const rule of IRREVERSIBLE_DENY) {
    assert.ok(
      spec.disallowedTools.includes(rule),
      `dealer spec missing IRREVERSIBLE_DENY rule: ${rule}`,
    );
  }
});

test('auditor spec disallowedTools contains every IRREVERSIBLE_DENY entry', () => {
  const spec = specFor(STUB_BEAD, 'auditor', WORKTREE);
  for (const rule of IRREVERSIBLE_DENY) {
    assert.ok(
      spec.disallowedTools.includes(rule),
      `auditor spec missing IRREVERSIBLE_DENY rule: ${rule}`,
    );
  }
});

// Invariant 3: auditor allowedTools carries no write capability (Edit/Write absent)
test('auditor spec allowedTools excludes Edit and Write', () => {
  const spec = specFor(STUB_BEAD, 'auditor', WORKTREE);
  assert.ok(!spec.allowedTools.includes('Edit'), 'auditor spec must not allow Edit');
  assert.ok(!spec.allowedTools.includes('Write'), 'auditor spec must not allow Write');
});

// Invariant 4: dealer spec allowedTools DOES include Edit and Write (control check)
test('dealer spec allowedTools includes Edit and Write', () => {
  const spec = specFor(STUB_BEAD, 'dealer', WORKTREE);
  assert.ok(spec.allowedTools.includes('Edit'), 'dealer spec must allow Edit');
  assert.ok(spec.allowedTools.includes('Write'), 'dealer spec must allow Write');
});

// Invariant 5: auditor != dealer — the firewall. Specs for same bead must differ by role
// and allowedTools, ensuring the author!=grader property holds structurally.
test('auditor spec role field is auditor, not dealer', () => {
  const dealerSpec = specFor(STUB_BEAD, 'dealer', WORKTREE);
  const auditorSpec = specFor(STUB_BEAD, 'auditor', WORKTREE);
  assert.equal(dealerSpec.role, 'dealer');
  assert.equal(auditorSpec.role, 'auditor');
  assert.notEqual(auditorSpec.role, dealerSpec.role);
});

test('auditor spec allowedTools differs from dealer spec allowedTools', () => {
  const dealerSpec = specFor(STUB_BEAD, 'dealer', WORKTREE);
  const auditorSpec = specFor(STUB_BEAD, 'auditor', WORKTREE);
  // They must differ — auditor is read-only, dealer can write
  assert.notDeepEqual(
    auditorSpec.allowedTools,
    dealerSpec.allowedTools,
    'auditor and dealer allowedTools must differ (auditor!=dealer firewall)',
  );
});

// Invariant 6: the deny-list itself is non-empty (guards against vacuous pass if arrays shrink to [])
test('BD_WRITE_DENY and IRREVERSIBLE_DENY are non-empty', () => {
  assert.ok(BD_WRITE_DENY.length > 0, 'BD_WRITE_DENY must not be empty');
  assert.ok(IRREVERSIBLE_DENY.length > 0, 'IRREVERSIBLE_DENY must not be empty');
});
