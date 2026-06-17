import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('RingBuffer items() returns oldest→newest order before and after wrap', () => {
  const rb = new RingBuffer<number>(3);
  rb.push(1);
  rb.push(2);
  expect(rb.items()).toEqual([1, 2]); // partially filled, in order
  rb.push(3);
  expect(rb.items()).toEqual([1, 2, 3]); // exactly full
  rb.push(4); // wraps: drops 1 (oldest)
  expect(rb.items()).toEqual([2, 3, 4]);
  rb.push(5);
  rb.push(6);
  expect(rb.items()).toEqual([4, 5, 6]); // oldest→newest after multiple wraps
});

test('RingBuffer pushMany respects the cap and order', () => {
  const rb = new RingBuffer<number>(3);
  rb.pushMany([1, 2, 3, 4, 5]);
  expect(rb.length).toBe(3);
  expect(rb.items()).toEqual([3, 4, 5]);
});

test('RingBuffer push past the cap is O(1) — no Array.prototype.splice', () => {
  const rb = new RingBuffer<number>(10);
  // Prime to capacity so subsequent pushes are in the wrap/evict path.
  for (let i = 0; i < 10; i++) rb.push(i);
  const spliceSpy = vi.spyOn(Array.prototype, 'splice');
  try {
    for (let i = 0; i < 1000; i++) rb.push(i);
    // A splice-based eviction would call splice once per overflow push.
    expect(spliceSpy).not.toHaveBeenCalled();
  } finally {
    spliceSpy.mockRestore();
  }
  expect(rb.length).toBe(10);
  expect(rb.items()).toEqual(Array.from({ length: 10 }, (_, i) => 990 + i));
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

test('truncation (size < offset) discards stale pending lines and cancels the flush timer', () => {
  vi.useFakeTimers();
  const path = tmpFile();
  writeFileSync(path, ''); // start empty → constructor arms no flush timer
  const batches: string[][] = [];
  const t = tailJournal(path, (added) => batches.push(added), { throttleMs: 50 });
  const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
  stops.push(() => {
    clearSpy.mockRestore();
    t.stop();
    vi.useRealTimers();
  });

  // Append three lines, then fire ONE poll tick. The poll's readNew reads them
  // into `pending` and arms a flush timer (it does NOT flush yet — the flush is
  // a later timer). They are pending, undelivered.
  appendFileSync(path, 'old-1\nold-2\nold-3\n');
  vi.advanceTimersToNextTimer(); // the poll interval tick → reads, arms flush
  expect(batches.flat()).toEqual([]); // armed + pending, not yet flushed
  clearSpy.mockClear();

  // Truncate below the advanced offset, then fire the next poll tick. The poll
  // interval (created in the constructor) fires before the flush timer (armed
  // later, inside the poll callback), so readNew detects size < offset, drops
  // the stale pending lines, and clears the armed flush timer.
  writeFileSync(path, 'x\n');
  vi.advanceTimersToNextTimer(); // the poll tick that detects truncation

  // The armed flush timer was cleared as part of truncation handling…
  expect(clearSpy).toHaveBeenCalled();
  // …and even after draining all timers the stale lines never get delivered.
  vi.advanceTimersByTime(200);
  expect(batches.flat()).not.toContain('old-1');
  expect(batches.flat()).not.toContain('old-2');
  expect(batches.flat()).not.toContain('old-3');
});

test('file deletion after a successful read surfaces an error (no silent freeze)', async () => {
  const path = tmpFile();
  writeFileSync(path, 'a\nb\n');
  const errors: Error[] = [];
  const t = tailJournal(path, () => {}, {
    throttleMs: 5,
    onError: (e) => errors.push(e),
  });
  stops.push(() => t.stop());

  // Wait for the first successful read so hasReadOnce is set.
  await vi.waitFor(() => expect(t.lines()).toEqual(['a', 'b']));

  // Delete the file out from under the tail. The next stat must fail; because a
  // read already succeeded, the failure is surfaced rather than swallowed.
  rmSync(path);
  await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
  expect(errors[0]).toBeInstanceOf(Error);
});

test('missing file BEFORE any successful read does NOT surface an error', async () => {
  const path = tmpFile('never-created.jsonl');
  const errors: Error[] = [];
  const t = tailJournal(path, () => {}, {
    throttleMs: 5,
    onError: (e) => errors.push(e),
  });
  stops.push(() => t.stop());
  // Give the poll several ticks; a not-yet-created journal is normal startup,
  // not an error.
  await new Promise((r) => setTimeout(r, 40));
  expect(errors).toEqual([]);
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
