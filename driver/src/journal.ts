import { mkdirSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface JournalEvent {
  type:
    | 'tick'
    | 'claim'
    | 'dispatch'
    | 'outcome'
    | 'merge'
    | 'close'
    | 'cap'
    | 'gate'
    /**
     * Phase 1c follow-up (bead 5va): a DISTINCT marker journaled AFTER an APPROVED
     * outward action's exec completes. Its presence proves the action ran exactly
     * once; its ABSENCE next to an approved 'gate' marks an indeterminate window
     * (crash between approve-journal and exec) — never a silent skip-and-close.
     */
    | 'gate-performed';
  beadId?: string;
  [k: string]: unknown;
}

/** Append-only, fsync'd JSONL journal for crash-safe, idempotent resume (spec §5.6). */
export class Journal {
  private done = new Set<string>();
  /** Latest event payload per (type, beadId) — lets resume read e.g. `approved`. */
  private latest = new Map<string, JournalEvent>();

  constructor(
    private path: string,
    replayed: JournalEvent[] = [],
  ) {
    mkdirSync(dirname(path), { recursive: true });
    for (const e of replayed) this.index(e);
  }

  private key(type: string, beadId?: string): string {
    return `${type}:${beadId ?? ''}`;
  }
  private index(e: JournalEvent) {
    if (e.beadId) {
      const k = this.key(e.type, e.beadId);
      this.done.add(k);
      this.latest.set(k, e);
    }
  }

  /** True if this (type, beadId) effect was already journaled — the exactly-once guard. */
  hasDone(type: JournalEvent['type'], beadId: string): boolean {
    return this.done.has(this.key(type, beadId));
  }

  /**
   * The latest journaled event of `type` for `beadId`, or null. Lets resume read a
   * recorded payload (e.g. a 'gate' event's `approved` flag) — not just whether the
   * effect happened. Reads the in-memory index; never re-parses the file.
   */
  find(type: JournalEvent['type'], beadId: string): JournalEvent | null {
    return this.latest.get(this.key(type, beadId)) ?? null;
  }

  async append(e: JournalEvent): Promise<void> {
    const fh = await open(this.path, 'a');
    try {
      await fh.write(`${JSON.stringify(e)}\n`);
      await fh.sync(); // fsync: durable before the effect runs
    } finally {
      await fh.close();
    }
    this.index(e);
  }

  static async replay(path: string): Promise<JournalEvent[]> {
    let raw = '';
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return [];
    }
    // Parse line-by-line and skip any unparseable line. A crash mid-append can leave a
    // torn final line; the append is fsync'd per whole line, so only the tail can be
    // partial. Tolerating it keeps resume from crashing on the very journal that exists
    // to make resume safe — never throw out of replay.
    const events: JournalEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as JournalEvent);
      } catch {
        /* torn/partial line — skip it */
      }
    }
    return events;
  }
}
