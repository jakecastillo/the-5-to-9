import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type MemoryEntry, MemoryStore, type RecallQuery, scoreEntry } from '../src/memory.ts';

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function entry(over: Partial<MemoryEntry>): MemoryEntry {
  return { type: 'semantic', text: 'x', keywords: [], importance: 0.5, ts: NOW, ...over };
}

async function withStore(run: (s: MemoryStore) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'f9mem-'));
  try {
    await run(new MemoryStore(join(dir, 'memory')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('scoreEntry rewards recency, importance, and keyword relevance', () => {
  const q: RecallQuery = { keywords: ['auth'], reader: 'dealer', budgetChars: 1000, now: NOW };
  const strong = entry({ keywords: ['auth'], importance: 1, ts: NOW });
  const weak = entry({ keywords: ['ui'], importance: 0, ts: NOW - 30 * DAY });
  assert.ok(scoreEntry(strong, q) > scoreEntry(weak, q));
});

test('recall returns the highest-scored entry first', async () => {
  await withStore(async (s) => {
    await s.write(entry({ text: 'auth lesson', keywords: ['auth'], importance: 0.9 }));
    await s.write(entry({ text: 'ui note', keywords: ['ui'], importance: 0.1 }));
    const r = await s.recall({ keywords: ['auth'], reader: 'dealer', budgetChars: 1000, now: NOW });
    assert.equal(r[0].text, 'auth lesson');
  });
});

// jnx.4: one corrupt/torn line in a memory file must NOT discard the whole file —
// readType should skip the bad line and keep the rest.
test('a corrupt line in a memory file does not discard the surviving entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9mem-'));
  try {
    const memDir = join(dir, 'memory');
    const s = new MemoryStore(memDir);
    await s.write(entry({ text: 'first', keywords: ['k'] }));
    // A corrupt MIDDLE line (not just the tail) wedged between two valid entries.
    await appendFile(join(memDir, 'semantic.jsonl'), '{ this is not valid json\n');
    await s.write(entry({ text: 'third', keywords: ['k'] }));
    const r = await s.recall({ keywords: ['k'], reader: 'dealer', budgetChars: 1000, now: NOW });
    assert.deepEqual(
      r.map((e) => e.text).sort(),
      ['first', 'third'],
      'both valid entries survive the corrupt middle line',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the firewall hides auditor-only memory from a Dealer but not an Auditor', async () => {
  await withStore(async (s) => {
    await s.write(
      entry({ type: 'procedural', text: 'the rubric', keywords: ['rubric'], audience: 'auditor' }),
    );
    const asDealer = await s.recall({
      keywords: ['rubric'],
      reader: 'dealer',
      budgetChars: 1000,
      now: NOW,
    });
    const asAuditor = await s.recall({
      keywords: ['rubric'],
      reader: 'auditor',
      budgetChars: 1000,
      now: NOW,
    });
    assert.equal(asDealer.length, 0);
    assert.equal(asAuditor.length, 1);
  });
});

test('recall stays under the char budget', async () => {
  await withStore(async (s) => {
    await s.write(entry({ text: 'a'.repeat(60), keywords: ['k'], importance: 0.9 }));
    await s.write(entry({ text: 'b'.repeat(60), keywords: ['k'], importance: 0.8 }));
    const r = await s.recall({ keywords: ['k'], reader: 'dealer', budgetChars: 80, now: NOW });
    const used = r.reduce((n, e) => n + e.text.length, 0);
    assert.ok(used <= 80);
    assert.equal(r.length, 1);
  });
});

test('compact evicts oldest-lowest-importance beyond the cap', async () => {
  await withStore(async (s) => {
    await s.write(entry({ type: 'episodic', text: 'keep-hi', importance: 0.9, ts: NOW }));
    await s.write(
      entry({ type: 'episodic', text: 'drop-lo-old', importance: 0.1, ts: NOW - 10 * DAY }),
    );
    const dropped = await s.compact('episodic', 1);
    assert.equal(dropped, 1);
    const r = await s.recall({
      keywords: [],
      types: ['episodic'],
      reader: 'dealer',
      budgetChars: 1000,
      now: NOW,
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].text, 'keep-hi');
  });
});
