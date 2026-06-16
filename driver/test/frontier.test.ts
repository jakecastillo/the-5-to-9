import assert from 'node:assert/strict';
import { test } from 'node:test';
import { independentFrontier } from '../src/frontier.ts';
import type { Bead } from '../src/types.ts';

const bead = (id: string, dirs?: string[]): Bead => ({ id, status: 'open', inScopeDirs: dirs });

test('disjoint touch-sets run in parallel up to K', () => {
  const f = independentFrontier([bead('a', ['src/x']), bead('b', ['src/y'])], { k: 2 });
  assert.deepEqual(
    f.map((x) => x.id),
    ['a', 'b'],
  );
});

test('overlapping touch-sets are serialized (only the first is taken)', () => {
  const f = independentFrontier([bead('a', ['src/x']), bead('b', ['src/x', 'src/y'])], { k: 2 });
  assert.deepEqual(
    f.map((x) => x.id),
    ['a'],
  );
});

test('a bead with unknown scope runs solo even when K>1', () => {
  const f = independentFrontier([bead('a'), bead('b', ['src/y'])], { k: 3 });
  assert.deepEqual(
    f.map((x) => x.id),
    ['a'],
  );
});

test('the interface barrier serializes beads touching shared interface dirs', () => {
  const f = independentFrontier([bead('a', ['api/types']), bead('b', ['api/routes'])], {
    k: 2,
    interfaceDirs: ['api/types', 'api/routes'],
  });
  assert.deepEqual(
    f.map((x) => x.id),
    ['a'],
  );
});

test('K caps the frontier size', () => {
  const f = independentFrontier([bead('a', ['x']), bead('b', ['y']), bead('c', ['z'])], { k: 2 });
  assert.equal(f.length, 2);
});

test('K is floored at 1', () => {
  const f = independentFrontier([bead('a', ['x']), bead('b', ['y'])], { k: 0 });
  assert.equal(f.length, 1);
});
