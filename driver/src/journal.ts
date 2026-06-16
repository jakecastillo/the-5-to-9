import { mkdirSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface JournalEvent {
  type: 'tick' | 'claim' | 'dispatch' | 'outcome' | 'merge' | 'close' | 'cap' | 'gate';
  beadId?: string;
  [k: string]: unknown;
}

/** Append-only, fsync'd JSONL journal for crash-safe, idempotent resume (spec §5.6). */
export class Journal {
  private done = new Set<string>();

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
    if (e.beadId) this.done.add(this.key(e.type, e.beadId));
  }

  /** True if this (type, beadId) effect was already journaled — the exactly-once guard. */
  hasDone(type: JournalEvent['type'], beadId: string): boolean {
    return this.done.has(this.key(type, beadId));
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
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as JournalEvent);
  }
}
