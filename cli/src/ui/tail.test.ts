import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { MAX_STREAM_LINES, RingBuffer, tailJournal } from './tail.ts';

function tmpFile(name = 'journal.jsonl'): string {
  const dir = mkdtempSync(join(tmpdir(), 'f9-tail-'));
  return join(dir, name);
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
  vi.useRealTimers();
});

test('RingBuffer keeps only the last `max` items', () => {
  const rb = new RingBuffer<number>(3);
  for (let i = 1; i <= 5; i++) rb.push(i);
  expect(rb.length).toBe(3);
  expect(rb.items()).toEqual([3, 4, 5]);
});

test('MAX_STREAM_LINES default is 1000', () => {
  expect(MAX_STREAM_LINES).toBe(1000);
});

test('tailJournal reads existing lines from offset 0, then only NEW appended lines', async () => {
  const path = tmpFile();
  writeFileSync(path, 'a\nb\nc\n');
  const batches: string[][] = [];
  const t = tailJournal(path, (added) => batches.push(added), { throttleMs: 5 });
  stops.push(() => t.stop());

  await vi.waitFor(() => expect(batches.flat()).toEqual(['a', 'b', 'c']));

  appendFileSync(path, 'd\ne\n');
  await vi.waitFor(() => expect(batches.flat()).toEqual(['a', 'b', 'c', 'd', 'e']));
  // 'd' and 'e' arrived without re-reading a/b/c (offset advanced).
  expect(t.lines()).toEqual(['a', 'b', 'c', 'd', 'e']);
});

test('tailJournal retains at most `max` lines (ring buffer cap)', async () => {
  const path = tmpFile();
  const total = 50;
  writeFileSync(path, `${Array.from({ length: total }, (_, i) => `L${i}`).join('\n')}\n`);
  const t = tailJournal(path, () => {}, { throttleMs: 5, max: 10 });
  stops.push(() => t.stop());
  await vi.waitFor(() => expect(t.lines().length).toBe(10));
  // The newest 10 lines are retained; older dropped from RAM.
  expect(t.lines()).toEqual(Array.from({ length: 10 }, (_, i) => `L${i + 40}`));
});

test('stop() removes the watcher — no callbacks after stop', async () => {
  const path = tmpFile();
  writeFileSync(path, 'x\n');
  let calls = 0;
  const t = tailJournal(path, () => calls++, { throttleMs: 5 });
  await vi.waitFor(() => expect(calls).toBeGreaterThan(0));
  const callsAtStop = calls;
  t.stop();
  appendFileSync(path, 'y\nz\n');
  // Give any (incorrectly surviving) watcher time to fire.
  await new Promise((r) => setTimeout(r, 60));
  expect(calls).toBe(callsAtStop);
});

test('rapid appends within throttleMs coalesce into one batched callback', async () => {
  const path = tmpFile();
  writeFileSync(path, '');
  const batches: string[][] = [];
  const t = tailJournal(path, (added) => batches.push(added), { throttleMs: 40 });
  stops.push(() => t.stop());
  appendFileSync(path, '1\n');
  appendFileSync(path, '2\n');
  appendFileSync(path, '3\n');
  await vi.waitFor(() => expect(batches.flat()).toEqual(['1', '2', '3']));
  // All three appended within the throttle window → a single coalesced batch.
  expect(batches.length).toBe(1);
});
