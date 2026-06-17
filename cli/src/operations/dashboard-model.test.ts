import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { BeadLite, BeadsRead } from '../beads-read.ts';
import { getDashboardModel } from './dashboard-model.ts';
import { status } from './status.ts';

/** A stub BeadsRead with the dashboard fixture counts. */
function stubBeads(): BeadsRead {
  const ready: BeadLite[] = [
    { id: 'r1', title: 'Ready one' },
    { id: 'r2', title: 'Ready two' },
  ];
  const inProgress: BeadLite[] = [{ id: 'ip1', title: 'In progress one' }];
  const blocked: BeadLite[] = [{ id: 'b1', title: 'Blocked one' }];
  return {
    available: () => true,
    ready: () => Promise.resolve(ready),
    list: (s) => Promise.resolve(s === 'in_progress' ? inProgress : blocked),
    count: (s) => Promise.resolve(s === 'closed' ? 5 : s === 'in_progress' ? 1 : 1),
    readyCount: () => Promise.resolve(ready.length),
  };
}

function emptyStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'f9-dash-'));
}

test('status() returns state + counts + readyCount + gate', async () => {
  const view = await status({ beads: stubBeads(), stateDir: emptyStateDir() });
  expect(view.readyCount).toBe(2);
  expect(view.counts).toEqual({ closed: 5, inProgress: 1, blocked: 1 });
  expect(view.gate).toBeNull();
  expect(view.state.active).toBe(false);
});

test('getDashboardModel() returns counts, progress, and the three bead arrays', async () => {
  const model = await getDashboardModel({ beads: stubBeads(), stateDir: emptyStateDir() });
  expect(model.counts).toEqual({ closed: 5, inProgress: 1, blocked: 1 });
  expect(model.readyCount).toBe(2);
  expect(model.ready.map((b) => b.id)).toEqual(['r1', 'r2']);
  expect(model.inProgress.map((b) => b.id)).toEqual(['ip1']);
  expect(model.blocked.map((b) => b.id)).toEqual(['b1']);
  // total = closed(5) + ready(2) + inProgress(1) + blocked(1) = 9.
  // pct mirrors the bash dashboard's integer division: (5*100)/9 = 55.
  expect(model.progress).toEqual({ closed: 5, total: 9, pct: 55 });
});

test('getDashboardModel() with zero work → pct 0, no divide-by-zero', async () => {
  const empty: BeadsRead = {
    available: () => true,
    ready: () => Promise.resolve([]),
    list: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
    readyCount: () => Promise.resolve(0),
  };
  const model = await getDashboardModel({ beads: empty, stateDir: emptyStateDir() });
  expect(model.progress).toEqual({ closed: 0, total: 0, pct: 0 });
});
