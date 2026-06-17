import { afterEach, expect, test, vi } from 'vitest';
import { createPoller } from './useShiftPoll.ts';

afterEach(() => {
  vi.useRealTimers();
});

test('createPoller calls read each tick and exposes data', async () => {
  vi.useFakeTimers();
  let n = 0;
  const read = vi.fn(async () => ({ n: ++n }));
  const p = createPoller(read, 100);
  // First read fires immediately on start.
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  expect(p.data).toEqual({ n: 1 });
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledTimes(2);
  expect(p.data).toEqual({ n: 2 });
  p.stop();
});

test('on read failure, data stays last-known-good and error is set', async () => {
  vi.useFakeTimers();
  let call = 0;
  const read = vi.fn(async () => {
    call++;
    if (call === 2) throw new Error('bd unreachable');
    return { ok: call };
  });
  const p = createPoller(read, 100);
  await vi.advanceTimersByTimeAsync(0);
  expect(p.data).toEqual({ ok: 1 });
  expect(p.error).toBeNull();
  await vi.advanceTimersByTimeAsync(100); // the throwing tick
  expect(p.data).toEqual({ ok: 1 }); // last-known-good preserved
  expect(p.error).toMatch(/bd unreachable/);
  await vi.advanceTimersByTimeAsync(100); // recovers
  expect(p.data).toEqual({ ok: 3 });
  expect(p.error).toBeNull();
  p.stop();
});

test('stop() clears the interval — read not called after stop', async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => ({}));
  const p = createPoller(read, 100);
  await vi.advanceTimersByTimeAsync(0);
  const callsAtStop = read.mock.calls.length;
  p.stop();
  await vi.advanceTimersByTimeAsync(500);
  expect(read.mock.calls.length).toBe(callsAtStop);
});

test('onUpdate is invoked when data/error change so React can re-render', async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => ({ v: 1 }));
  const updates: number[] = [];
  const p = createPoller(read, 100, () => updates.push(1));
  await vi.advanceTimersByTimeAsync(0);
  expect(updates.length).toBeGreaterThan(0);
  p.stop();
});
