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
