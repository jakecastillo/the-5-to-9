import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { Resolution } from '../consent.ts';
import { consentCheckpoint } from './run.ts';

function tmpState(): string {
  return mkdtempSync(join(tmpdir(), 'f9-runc-'));
}

// A journal sink that records every appended event.
function fakeJournal() {
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  return {
    append: vi.fn(async (e: { type: string; [k: string]: unknown }) => {
      events.push(e);
    }),
    events,
  };
}

test('a benign (non-irreversible) command proceeds with NO consent request', async () => {
  const stateDir = tmpState();
  const journal = fakeJournal();
  const await_ = vi.fn();
  const res = await consentCheckpoint(
    { command: 'npm test', beadId: 't59-1', role: 'Dealer' },
    {
      stateDir,
      journal,
      classify: () => ({ denied: false, segment: null }),
      awaitResolution: await_ as never,
    },
  );
  expect(res.proceed).toBe(true);
  expect(await_).not.toHaveBeenCalled(); // no consent for a benign command
  expect(journal.events).toHaveLength(0);
});

test('an APPROVED irreversible action proceeds and journals a gate event', async () => {
  const stateDir = tmpState();
  const journal = fakeJournal();
  const approved: Resolution = {
    id: 'x',
    approved: true,
    token: 'gh',
    resolvedAt: '2026-06-17T00:00:00Z',
  };
  const res = await consentCheckpoint(
    { command: 'gh release create v1', beadId: 't59-7e0', role: 'Cage' },
    {
      stateDir,
      journal,
      classify: () => ({ denied: true, segment: 'gh release create v1' }),
      // Inject the resolver so the test never sleeps and never depends on a TTY.
      awaitResolution: vi.fn(async () => approved),
    },
  );
  expect(res.proceed).toBe(true);
  const gate = journal.events.find((e) => e.type === 'gate');
  expect(gate).toBeDefined();
  expect(gate?.approved).toBe(true);
  expect(gate?.beadId).toBe('t59-7e0');
});

test('a DENIED irreversible action does NOT proceed, is skipped + recorded + journaled', async () => {
  const stateDir = tmpState();
  const journal = fakeJournal();
  const denied: Resolution = {
    id: 'x',
    approved: false,
    token: null,
    resolvedAt: '2026-06-17T00:00:00Z',
  };
  const res = await consentCheckpoint(
    { command: 'git push --force origin main', beadId: 't59-9', role: 'Floorman' },
    {
      stateDir,
      journal,
      classify: () => ({ denied: true, segment: 'git push --force origin main' }),
      awaitResolution: vi.fn(async () => denied),
    },
  );
  // INVARIANT: a deny is fail-closed — the action is skipped, never silent-allowed.
  expect(res.proceed).toBe(false);
  expect(res.skipped).toBe(true);
  const gate = journal.events.find((e) => e.type === 'gate');
  expect(gate).toBeDefined();
  expect(gate?.approved).toBe(false);
});

test('a TIMEOUT (deny via injected clock) skips the action — no real sleeping, no silent-allow', async () => {
  const stateDir = tmpState();
  const journal = fakeJournal();
  // Injected clock jumps past the timeout so awaitResolution returns a DENY
  // without any real timer. We use the REAL awaitResolution here to exercise
  // the timeout→deny path end to end.
  let t = 0;
  const now = () => {
    const v = t;
    t += 10_000;
    return v;
  };
  const res = await consentCheckpoint(
    { command: 'kubectl delete namespace prod', beadId: 't59-2', role: 'Pit Boss' },
    {
      stateDir,
      journal,
      classify: () => ({ denied: true, segment: 'kubectl delete namespace prod' }),
      now,
      timeoutMs: 100,
      pollMs: 1,
    },
  );
  expect(res.proceed).toBe(false);
  expect(res.skipped).toBe(true);
  const gate = journal.events.find((e) => e.type === 'gate');
  expect(gate?.approved).toBe(false);
});
