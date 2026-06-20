import { mkdirSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'user';
export type Audience = 'all' | 'auditor';

export interface MemoryEntry {
  type: MemoryType;
  text: string;
  keywords: string[];
  importance: number; // 0..1, set at write time
  ts: number; // epoch ms (recency)
  confidence?: number;
  /** 'auditor' firewalls the entry from Dealers (the rubric firewall, spec §6). Default 'all'. */
  audience?: Audience;
}

export interface RecallQuery {
  keywords: string[];
  types?: MemoryType[];
  reader: 'dealer' | 'auditor';
  budgetChars: number; // hard per-task budget (char proxy for tokens)
  now: number; // injected clock → deterministic
  topK?: number;
}

const ALL_TYPES: MemoryType[] = ['episodic', 'semantic', 'procedural', 'user'];
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // one week

/** recency + importance + relevance (equal-weight, Generative-Agents style; spec §6). */
export function scoreEntry(e: MemoryEntry, q: RecallQuery): number {
  const ageMs = Math.max(0, q.now - e.ts);
  const recency = Math.exp((-Math.LN2 * ageMs) / HALF_LIFE_MS); // 1 at age 0, 0.5 per half-life
  const importance = Math.min(1, Math.max(0, e.importance));
  const qset = new Set(q.keywords.map((k) => k.toLowerCase()));
  const overlap = e.keywords.filter((k) => qset.has(k.toLowerCase())).length;
  const relevance = qset.size === 0 ? 0 : overlap / qset.size;
  return recency + importance + relevance;
}

/**
 * Low-bloat, just-in-time, file-based memory store (spec §6). Plain JSONL per type, no sqlite,
 * no embedding index. Writes are append-only (the Cage serializes them); reads scan + score.
 */
export class MemoryStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(type: MemoryType): string {
    return join(this.dir, `${type}.jsonl`);
  }

  async write(entry: MemoryEntry): Promise<void> {
    await appendFile(this.file(entry.type), `${JSON.stringify(entry)}\n`);
  }

  private async readType(type: MemoryType): Promise<MemoryEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.file(type), 'utf8');
    } catch {
      return []; // no file for this type yet
    }
    // Parse per line and skip a corrupt/torn one rather than discarding the whole file:
    // a single bad line (e.g. a crash mid-append) must not wipe every memory of this type.
    const entries: MemoryEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as MemoryEntry);
      } catch {
        /* corrupt/torn line — skip it, keep the rest */
      }
    }
    return entries;
  }

  /** JIT recall: firewall by reader, score, then take the top entries that fit the char budget. */
  async recall(q: RecallQuery): Promise<MemoryEntry[]> {
    const types = q.types ?? ALL_TYPES;
    const all: MemoryEntry[] = [];
    for (const t of types) all.push(...(await this.readType(t)));

    const visible = all.filter((e) => (e.audience ?? 'all') === 'all' || q.reader === 'auditor');
    const scored = visible.map((e) => ({ e, s: scoreEntry(e, q) })).sort((a, b) => b.s - a.s);

    const out: MemoryEntry[] = [];
    const topK = q.topK ?? Number.POSITIVE_INFINITY;
    let used = 0;
    for (const { e } of scored) {
      if (out.length >= topK) break;
      if (used + e.text.length > q.budgetChars) continue; // pack: skip overflow, try smaller ones
      out.push(e);
      used += e.text.length;
    }
    return out;
  }

  /** Size-cap a type: keep the top N by (importance, recency); evict oldest-lowest-importance. */
  async compact(type: MemoryType, maxEntries: number): Promise<number> {
    const entries = await this.readType(type);
    if (entries.length <= maxEntries) return 0;
    const kept = [...entries]
      .sort((a, b) => b.importance - a.importance || b.ts - a.ts)
      .slice(0, maxEntries);
    const body = kept.map((e) => JSON.stringify(e)).join('\n');
    await writeFile(this.file(type), kept.length ? `${body}\n` : '');
    return entries.length - kept.length;
  }
}
