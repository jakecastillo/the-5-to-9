import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { BeadLite, BeadsRead } from '../beads-read.ts';
import { requestConsent } from '../consent.ts';
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

test('getDashboardModel() with no pending consent → pendingGate is undefined', async () => {
  const model = await getDashboardModel({ beads: stubBeads(), stateDir: emptyStateDir() });
  expect(model.pendingGate).toBeUndefined();
});

test('getDashboardModel() surfaces a pending consent as pendingGate', async () => {
  const dir = emptyStateDir();
  const p = requestConsent(
    { command: 'gh release create v1', category: 'publish', beadId: 't59-7e0', role: 'Cage' },
    { stateDir: dir },
  );
  const model = await getDashboardModel({ beads: stubBeads(), stateDir: dir });
  expect(model.pendingGate).toBeDefined();
  expect(model.pendingGate?.id).toBe(p.id);
  expect(model.pendingGate?.command).toBe('gh release create v1');
  expect(model.pendingGate?.segment).toBe('gh release create v1');
  expect(model.pendingGate?.category).toBe('publish');
  expect(model.pendingGate?.token).toBe(p.token);
  expect(model.pendingGate?.bead).toBe('t59-7e0');
  expect(model.pendingGate?.role).toBe('Cage');
});

test('jnx.7: counts derive from the fetched lists (never diverge) and bd is not double-spawned', async () => {
  const calls: string[] = [];
  const ready: BeadLite[] = [
    { id: 'r1', title: 'a' },
    { id: 'r2', title: 'b' },
  ];
  const inProgress: BeadLite[] = [{ id: 'ip1', title: 'c' }];
  const blocked: BeadLite[] = [
    { id: 'bk1', title: 'd' },
    { id: 'bk2', title: 'e' },
    { id: 'bk3', title: 'f' },
  ];
  const beads: BeadsRead = {
    available: () => true,
    ready: () => {
      calls.push('ready');
      return Promise.resolve(ready);
    },
    list: (s) => {
      calls.push(`list:${s}`);
      return Promise.resolve(s === 'in_progress' ? inProgress : blocked);
    },
    // counts DELIBERATELY diverge from the list lengths (stale/racy bd) — must be ignored.
    count: (s) => {
      calls.push(`count:${s}`);
      return Promise.resolve(s === 'closed' ? 5 : 999);
    },
    readyCount: () => {
      calls.push('readyCount');
      return Promise.resolve(999);
    },
  };
  const model = await getDashboardModel({ beads, stateDir: emptyStateDir() });
  // Counts come from the lists, not the divergent count()/readyCount().
  expect(model.counts.inProgress).toBe(inProgress.length); // 1, not 999
  expect(model.counts.blocked).toBe(blocked.length); // 3, not 999
  expect(model.readyCount).toBe(ready.length); // 2, not 999
  // No double-spawn: in_progress/blocked are fetched as a list ONLY (not also counted),
  // and readyCount() is never called (ready() supersedes it). closed is counted once.
  expect(calls).not.toContain('count:in_progress');
  expect(calls).not.toContain('count:blocked');
  expect(calls).not.toContain('readyCount');
  expect(calls.filter((c) => c === 'count:closed')).toHaveLength(1);
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
