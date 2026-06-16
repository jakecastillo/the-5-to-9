import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Journal } from '../src/journal.ts';
import { type ShiftDeps, type TickOutcome, runShift } from '../src/loop.ts';
import { BudgetLedger, RunLog } from '../src/observability.ts';

async function withShift(
  tick: (i: number) => Promise<TickOutcome>,
  over: Partial<ShiftDeps>,
  run: (deps: ShiftDeps) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'f9loop-'));
  try {
    await run({
      tick,
      ledger: over.ledger ?? new BudgetLedger(0, 0),
      log: new RunLog(join(dir, 'events.jsonl')),
      journal: new Journal(join(dir, 'journal.jsonl')),
      maxIterations: over.maxIterations ?? 30,
      noProgressWindow: over.noProgressWindow ?? 3,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('stops at the iteration cap', async () => {
  await withShift(
    async (i) => ({ closedIds: [`b${i}`], empty: false }),
    { maxIterations: 3 },
    async (deps) => {
      const r = await runShift(deps);
      assert.equal(r.iterations, 3);
      assert.equal(r.stopped, 'cap');
      assert.deepEqual(r.closed, ['b1', 'b2', 'b3']);
    },
  );
});

test('stops when the queue is empty', async () => {
  await withShift(
    async (i) => (i === 1 ? { closedIds: ['b1'], empty: false } : { closedIds: [], empty: true }),
    {},
    async (deps) => {
      const r = await runShift(deps);
      assert.equal(r.stopped, 'queue-empty');
      assert.equal(r.iterations, 1);
      assert.deepEqual(r.closed, ['b1']);
    },
  );
});

test('stops on no-progress after the window', async () => {
  await withShift(
    async () => ({ closedIds: [], empty: false }),
    { noProgressWindow: 2 },
    async (deps) => {
      const r = await runShift(deps);
      assert.equal(r.stopped, 'no-progress');
      assert.equal(r.iterations, 2);
    },
  );
});

test('stops immediately on a pre-breached budget', async () => {
  const ledger = new BudgetLedger(0.01, 0);
  ledger.add(0.02);
  await withShift(
    async () => ({ closedIds: ['x'], empty: false }),
    { ledger },
    async (deps) => {
      const r = await runShift(deps);
      assert.equal(r.stopped, 'budget');
      assert.equal(r.iterations, 0);
      assert.deepEqual(r.closed, []);
    },
  );
});
