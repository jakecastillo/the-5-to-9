import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Journal } from '../src/journal.ts';

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'f9-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('append then replay reconstructs events in order', async () => {
  await withDir(async (dir) => {
    const j = new Journal(join(dir, 'journal.jsonl'));
    await j.append({ type: 'claim', beadId: 'b1' });
    await j.append({ type: 'close', beadId: 'b1' });
    const events = await Journal.replay(join(dir, 'journal.jsonl'));
    assert.deepEqual(
      events.map((e) => e.type),
      ['claim', 'close'],
    );
  });
});

test('hasDone() makes close idempotent across a simulated crash', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'journal.jsonl');
    const j1 = new Journal(path);
    await j1.append({ type: 'close', beadId: 'b1' });
    // simulate restart: new Journal over the same file
    const events = await Journal.replay(path);
    const j2 = new Journal(path, events);
    assert.equal(j2.hasDone('close', 'b1'), true);
    assert.equal(j2.hasDone('close', 'b2'), false);
  });
});

// jnx.4: a crash mid-append leaves a torn (unterminated) final line. replay() must
// keep every complete event and NOT throw — else resume itself crashes on restart.
test('replay tolerates a torn final line and keeps the complete events', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'journal.jsonl');
    const j = new Journal(path);
    await j.append({ type: 'claim', beadId: 'b1' });
    await j.append({ type: 'close', beadId: 'b1' });
    // Crash mid-write: a partial, unterminated JSON line at the tail (no newline).
    await appendFile(path, '{"type":"merge","beadId":"b2"');
    const events = await Journal.replay(path);
    assert.deepEqual(
      events.map((e) => e.type),
      ['claim', 'close'],
      'complete events survive the torn tail',
    );
    const j2 = new Journal(path, events);
    assert.equal(j2.hasDone('close', 'b1'), true);
    assert.equal(j2.hasDone('merge', 'b2'), false, 'the torn event is not indexed');
  });
});
