import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WriteQueue } from '../src/write-queue.ts';

test('serializes writes — no two run concurrently', async () => {
  const q = new WriteQueue();
  let active = 0;
  let maxActive = 0;
  const job = () => async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  };
  await Promise.all([q.run(job()), q.run(job()), q.run(job())]);
  assert.equal(maxActive, 1);
});

test('preserves FIFO order and returns values', async () => {
  const q = new WriteQueue();
  const out: number[] = [];
  const results = await Promise.all(
    [1, 2, 3].map((n) =>
      q.run(async () => {
        out.push(n);
        return n * 10;
      }),
    ),
  );
  assert.deepEqual(out, [1, 2, 3]);
  assert.deepEqual(results, [10, 20, 30]);
});

test('a rejecting job does not break the queue', async () => {
  const q = new WriteQueue();
  await assert.rejects(
    q.run(async () => {
      throw new Error('boom');
    }),
  );
  assert.equal(await q.run(async () => 'ok'), 'ok');
});
