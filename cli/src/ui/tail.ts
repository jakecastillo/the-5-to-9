import { type FSWatcher, closeSync, openSync, readSync, statSync, watch } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The default cap on retained stream lines. Older lines are DROPPED from the
 * in-memory array (not merely hidden) — the on-disk journal is the source of
 * truth, so the TUI never needs the full history in RAM. (Spec: Memory §1.)
 */
export const MAX_STREAM_LINES = 1000;

/** A fixed-capacity FIFO buffer: pushing past `max` drops the oldest item. */
export class RingBuffer<T> {
  private buf: T[] = [];
  constructor(private max: number) {}

  push(x: T): void {
    this.buf.push(x);
    if (this.buf.length > this.max) {
      // Drop from the front so memory stays O(max), never O(total).
      this.buf.splice(0, this.buf.length - this.max);
    }
  }

  pushMany(xs: T[]): void {
    for (const x of xs) this.push(x);
  }

  items(): T[] {
    return this.buf.slice();
  }

  get length(): number {
    return this.buf.length;
  }
}

/** A live journal tail. */
export interface JournalTail {
  /** The retained lines (≤ max), newest last. */
  lines(): string[];
  /** Stop watching: close fs.watch, clear the throttle timer + poll interval. */
  stop(): void;
}

export interface TailOpts {
  /** Coalesce window in ms (default 200 → ~5 Hz). Also the poll cadence. */
  throttleMs?: number;
  /** Ring-buffer cap (default MAX_STREAM_LINES). */
  max?: number;
}

/**
 * Tail an append-only journal FROM A BYTE OFFSET. Never reads the whole file:
 * each check reads only `[offset, EOF)`, splits complete lines, advances the
 * offset, and feeds a bounded `RingBuffer`. New lines are coalesced and
 * delivered to `onLines` in one batch per `throttleMs` flush.
 *
 * Change detection is a `throttleMs` poll of the file size (deterministic and
 * portable — macOS `fs.watch` misses appends to a file created empty), with an
 * `fs.watch` early-trigger optimization layered on top. Memory is O(new lines),
 * never O(file size).
 *
 * `stop()` is the deterministic cleanup: it clears the poll interval + throttle
 * timer and closes the fs.watch handle, so no callback fires after stop and no
 * watcher/timer leaks (spec: Memory §7).
 */
export function tailJournal(
  path: string,
  onLines: (added: string[]) => void,
  opts: TailOpts = {},
): JournalTail {
  const throttleMs = opts.throttleMs ?? 200;
  const max = opts.max ?? MAX_STREAM_LINES;
  const ring = new RingBuffer<string>(max);

  let offset = 0;
  let leftover = ''; // an incomplete trailing line carried to the next read
  let pending: string[] = []; // lines awaiting the next coalesced flush
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let watcher: FSWatcher | null = null;
  let stopped = false;

  function readNew(): void {
    if (stopped) return;
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return; // file vanished — nothing to read
    }
    if (size < offset) {
      // Truncated/rotated: restart from the top.
      offset = 0;
      leftover = '';
    }
    if (size === offset) return;

    const fd = openSync(path, 'r');
    try {
      const len = size - offset;
      const buf = Buffer.allocUnsafe(len);
      const read = readSync(fd, buf, 0, len, offset);
      offset += read;
      const chunk = leftover + buf.toString('utf8', 0, read);
      const parts = chunk.split('\n');
      // The last element is an incomplete line (no trailing newline yet).
      leftover = parts.pop() ?? '';
      if (parts.length > 0) pending.push(...parts);
    } finally {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }

    scheduleFlush();
  }

  function scheduleFlush(): void {
    if (stopped || flushTimer != null || pending.length === 0) return;
    flushTimer = setTimeout(flush, throttleMs);
  }

  function flush(): void {
    flushTimer = null;
    if (stopped || pending.length === 0) return;
    const batch = pending;
    pending = [];
    ring.pushMany(batch);
    onLines(batch);
  }

  // Initial read from offset 0 (existing content).
  readNew();

  // Primary change detection: a portable size poll.
  pollTimer = setInterval(readNew, throttleMs);
  // Optional early-trigger: fs.watch on the file (best-effort; ignored if it
  // throws or the platform misses events — the poll still catches everything).
  try {
    watcher = watch(path, () => readNew());
  } catch {
    try {
      watcher = watch(dirname(path), () => readNew());
    } catch {
      watcher = null;
    }
  }

  return {
    lines: () => ring.items(),
    stop(): void {
      stopped = true;
      if (flushTimer != null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pollTimer != null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (watcher != null) {
        watcher.close();
        watcher = null;
      }
      pending = [];
    },
  };
}
