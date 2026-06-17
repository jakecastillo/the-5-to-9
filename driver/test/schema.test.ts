import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWorkerOutcome } from '../src/schema.ts';

test('accepts a valid worker outcome', () => {
  const r = validateWorkerOutcome({
    beadId: 'b1',
    role: 'dealer',
    status: 'done',
    summary: 'implemented',
    filesTouched: ['a.ts'],
    costUsd: 0.01,
  });
  assert.equal(r.ok, true);
});

test('rejects an outcome missing required fields', () => {
  const r = validateWorkerOutcome({ beadId: 'b1' });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /role|status/);
});

test('rejects an unknown status', () => {
  const r = validateWorkerOutcome({
    beadId: 'b1',
    role: 'dealer',
    status: 'maybe',
    summary: 's',
    filesTouched: [],
    costUsd: 0,
  });
  assert.equal(r.ok, false);
});

test('accepts an optional string requestedAction (an outward action needing consent)', () => {
  const r = validateWorkerOutcome({
    beadId: 'b1',
    role: 'dealer',
    status: 'done',
    summary: 'surfaced an outward action',
    filesTouched: [],
    costUsd: 0,
    requestedAction: 'gh release create v1',
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok ? r.value.requestedAction : undefined, 'gh release create v1');
});

test('rejects a non-string requestedAction (must be a string if present)', () => {
  const r = validateWorkerOutcome({
    beadId: 'b1',
    role: 'dealer',
    status: 'done',
    summary: 's',
    filesTouched: [],
    costUsd: 0,
    requestedAction: 42,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /requestedAction/);
});

test('an absent requestedAction is fine (optional)', () => {
  const r = validateWorkerOutcome({
    beadId: 'b1',
    role: 'dealer',
    status: 'done',
    summary: 's',
    filesTouched: [],
    costUsd: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok ? r.value.requestedAction : 'x', undefined);
});
