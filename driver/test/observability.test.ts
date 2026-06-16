import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BudgetLedger, RunLog } from '../src/observability.ts';

test('RunLog writes one NDJSON record per event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9log-'));
  try {
    const log = new RunLog(join(dir, 'events.jsonl'));
    await log.write({ kind: 'tick', n: 1 });
    await log.write({ kind: 'close', beadId: 'b1' });
    const lines = (await readFile(join(dir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).kind, 'tick');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('BudgetLedger trips the breaker when cost exceeds the cap', () => {
  const led = new BudgetLedger(0.05, 0);
  led.add(0.02);
  assert.equal(led.breached(), false);
  led.add(0.04);
  assert.equal(led.breached(), true);
});
