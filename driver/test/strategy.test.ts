import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ValuedBead, enforceStrategy, scoreBeadValue } from '../src/strategy.ts';

const vb = (id: string, over: Partial<ValuedBead> = {}): ValuedBead => ({
  id,
  status: 'open',
  ...over,
});

test('scoreBeadValue rewards proximity + unblocks and penalizes failed attempts', () => {
  const high = scoreBeadValue(vb('a', { acceptanceProximity: 1, unblocks: 4 }));
  const low = scoreBeadValue(vb('b', { acceptanceProximity: 0, unblocks: 0, failedAttempts: 3 }));
  assert.ok(high > low);
});

test('reprioritize and add are always applied', () => {
  const r = enforceStrategy(
    [
      { kind: 'reprioritize', beadId: 'a', priority: 1 },
      { kind: 'add', bead: { id: 'new', status: 'open' } },
    ],
    [vb('a')],
  );
  assert.equal(r.applied.length, 2);
  assert.equal(r.rejected.length, 0);
});

test('pruning a human-created bead is REJECTED', () => {
  const r = enforceStrategy([{ kind: 'prune', beadId: 'h' }], [vb('h', { createdByHuman: true })]);
  assert.equal(r.applied.length, 0);
  assert.match(r.rejected[0].reason, /human-created/);
});

test('pruning an in-progress bead is REJECTED', () => {
  const r = enforceStrategy([{ kind: 'prune', beadId: 'p' }], [vb('p', { hasProgress: true })]);
  assert.equal(r.applied.length, 0);
  assert.match(r.rejected[0].reason, /progress/);
});

test('pruning a machine-created, no-progress bead is APPLIED', () => {
  const r = enforceStrategy(
    [{ kind: 'prune', beadId: 'm' }],
    [vb('m', { createdByHuman: false, hasProgress: false })],
  );
  assert.equal(r.applied.length, 1);
  assert.equal(r.rejected.length, 0);
});

test('pruning an unknown bead is REJECTED', () => {
  const r = enforceStrategy([{ kind: 'prune', beadId: 'ghost' }], []);
  assert.match(r.rejected[0].reason, /unknown/);
});
