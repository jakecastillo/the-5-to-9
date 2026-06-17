import { type FSWatcher, closeSync, openSync, readSync, statSync, watch } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The default cap on retained stream lines. Older lines are DROPPED from the
 * in-memory array (not merely hidden) — the on-disk journal is the source of
 * truth, so the TUI never needs the full history in RAM. (Spec: Memory §1.)
 */
export const MAX_STREAM_LINES = 1000;

/**
 * A fixed-capacity FIFO ring: pushing past `max` overwrites the oldest slot in
 * place. `push` is O(1) — no array growth and no front-splice — so memory stays
 * O(max) and writes never degrade as the journal grows. `items()` materializes
 * the retained slots oldest→newest.
 */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0; // index of the oldest retained item (meaningful once full)
  private len = 0; // number of retained items (≤ max)
  private readonly max: number;

  constructor(max: number) {
    this.max = Math.max(1, max);
    this.buf = new Array<T | undefined>(this.max);
  }

  push(x: T): void {
    if (this.len < this.max) {
      // Not yet full: append at the logical tail.
      this.buf[(this.head + this.len) % this.max] = x;
      this.len++;
    } else {
      // Full: overwrite the oldest slot, then advance head. O(1), no splice.
      this.buf[this.head] = x;
      this.head = (this.head + 1) % this.max;
    }
  }

  pushMany(xs: T[]): void {
    for (const x of xs) this.push(x);
  }

  items(): T[] {
    const out = new Array<T>(this.len);
    for (let i = 0; i < this.len; i++) {
      out[i] = this.buf[(this.head + i) % this.max] as T;
    }
    return out;
  }

  get length(): number {
    return this.len;
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
  /**
   * Surfaced when a stat/read FAILS after at least one successful read (e.g. the
   * journal was deleted out from under the tail). A missing file BEFORE the
   * first successful read is normal startup and is NOT reported. Fired at most
   * once per failure transition so the consumer can show a status line instead
   * of the output silently freezing.
   */
  onError?: (err: Error) => void;
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
  const onError = opts.onError;
  const ring = new RingBuffer<string>(max);

  let offset = 0;
  let leftover = ''; // an incomplete trailing line carried to the next read
  let pending: string[] = []; // lines awaiting the next coalesced flush
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let watcher: FSWatcher | null = null;
  let stopped = false;
  let hasReadOnce = false; // a read succeeded → later failures are real errors
  let errored = false; // de-dupe: surface a given failure transition once

  /** Cancel an armed flush and drop any not-yet-delivered lines. */
  function dropPending(): void {
    if (flushTimer != null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = [];
  }

  /** Surface a post-first-read failure once (deletion, unreadable file). */
  function surfaceError(err: unknown): void {
    if (!hasReadOnce || errored || stopped) return;
    errored = true;
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }

  function readNew(): void {
    if (stopped) return;
    let size: number;
    try {
      size = statSync(path).size;
    } catch (err) {
      // A not-yet-created journal before the first successful read is normal
      // startup. A failure AFTER a good read means the file vanished/became
      // unreadable — surface it instead of silently freezing the output.
      surfaceError(err);
      return;
    }
    if (size < offset) {
      // Truncated/rotated: restart from the top. Any lines still pending from
      // before the truncation are now stale — drop them and cancel the flush so
      // the post-truncation read starts clean.
      offset = 0;
      leftover = '';
      dropPending();
    }
    if (size === offset) return;

    let read: number;
    let chunk: string;
    try {
      const fd = openSync(path, 'r');
      try {
        const len = size - offset;
        const buf = Buffer.allocUnsafe(len);
        read = readSync(fd, buf, 0, len, offset);
        chunk = leftover + buf.toString('utf8', 0, read);
      } finally {
        try {
          closeSync(fd);
        } catch {
          // best-effort
        }
      }
    } catch (err) {
      // Stat saw a size but the open/read failed (raced deletion, perms): same
      // surface-don't-freeze contract once a read has already succeeded.
      surfaceError(err);
      return;
    }

    offset += read;
    hasReadOnce = true;
    const parts = chunk.split('\n');
    // The last element is an incomplete line (no trailing newline yet).
    leftover = parts.pop() ?? '';
    if (parts.length > 0) pending.push(...parts);

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
