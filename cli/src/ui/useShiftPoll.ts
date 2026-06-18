import { useEffect, useRef, useState } from 'react';
import { type DashboardModel, getDashboardModel } from '../operations/dashboard-model.ts';

/** A read function the poller ticks. */
export type PollRead<T> = () => Promise<T>;

/** The non-React poller. Owns one interval; keeps last-known-good on failure. */
export interface Poller<T> {
  /** Last-known-good data (null until the first successful read). */
  data: T | null;
  /** The current transient error message, or null. */
  error: string | null;
  /** Stop the interval; no read fires after this. */
  stop(): void;
}

/**
 * A single-interval poller, decoupled from React so it is unit-testable. It
 * fires `read` immediately, then every `intervalMs`. On a thrown read it keeps
 * the last-known-good `data` and sets `error` (self-healing — never blanks the
 * view); a later success clears the error. `onUpdate` lets a React wrapper
 * re-render. Diffs into ONE object — never an array of snapshots (Memory §5).
 */
export function createPoller<T>(
  read: PollRead<T>,
  intervalMs: number,
  onUpdate?: () => void,
): Poller<T> {
  const state: Poller<T> = {
    data: null,
    error: null,
    stop,
  };
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const next = await read();
      if (stopped) return;
      state.data = next; // overwrite in place — single object, no history
      state.error = null;
    } catch (err) {
      if (stopped) return;
      // Keep last-known-good data; only record the error.
      state.error = err instanceof Error ? err.message : String(err);
    }
    onUpdate?.();
  }

  function stop(): void {
    stopped = true;
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }

  // Fire immediately so the first frame is fresh, then on the interval.
  void tick();
  timer = setInterval(() => void tick(), intervalMs);

  return state;
}

/** The hook's return shape. */
export interface ShiftPoll {
  data: DashboardModel | null;
  error: string | null;
}

/**
 * Poll the dashboard model on a single owned interval. Selection/scroll/filter
 * live in the consuming component's separate state — the poller only updates
 * `data`/`error`. The `useEffect` cleanup stops the poller on unmount or when
 * `enabled` flips (deterministic cleanup — Memory §7). `read` is injectable for
 * tests; production uses the facade's `getDashboardModel`.
 */
export function useShiftPoll(
  intervalMs: number,
  enabled: boolean,
  read: PollRead<DashboardModel> = getDashboardModel,
): ShiftPoll {
  const [, force] = useState(0);
  const pollerRef = useRef<Poller<DashboardModel> | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Stop any poller still on the ref BEFORE nulling it, so the disable path
      // can never orphan a live interval (the React cleanup also stops it; this
      // is the defensive guarantee that a leaked poller is always torn down).
      pollerRef.current?.stop();
      pollerRef.current = null;
      return;
    }
    const poller = createPoller(read, intervalMs, () => force((n) => n + 1));
    pollerRef.current = poller;
    return () => {
      poller.stop();
      pollerRef.current = null;
    };
  }, [intervalMs, enabled, read]);

  const p = pollerRef.current;
  return { data: p?.data ?? null, error: p?.error ?? null };
}
