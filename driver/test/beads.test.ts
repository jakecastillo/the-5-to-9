import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Beads } from '../src/beads.ts';
import type { ExecFn } from '../src/exec.ts';
import { WriteQueue } from '../src/write-queue.ts';

function mockExec(scripts: Record<string, { stdout?: string; code?: number }>): {
  fn: ExecFn;
  calls: string[];
} {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    const match = Object.entries(scripts).find(([k]) => key.startsWith(k));
    const r = match ? match[1] : { stdout: '', code: 0 };
    if ((r.code ?? 0) !== 0) throw new Error(`exit ${r.code}: ${key}`);
    return { stdout: r.stdout ?? '', stderr: '', code: 0 };
  };
  return { fn, calls };
}

test('ready() parses --json output', async () => {
  const { fn } = mockExec({
    'bd ready': { stdout: JSON.stringify([{ id: 'b1', status: 'open' }]) },
  });
  const beads = new Beads(fn, new WriteQueue());
  const ready = await beads.ready();
  assert.equal(ready[0].id, 'b1');
});

test('close() routes through the write queue and shells bd close', async () => {
  const { fn, calls } = mockExec({ 'bd close': { stdout: '{}' } });
  const beads = new Beads(fn, new WriteQueue());
  await beads.close('b1', 'done');
  assert.ok(calls.some((c) => c.startsWith('bd close b1')));
});

test('nonzero exit on a write surfaces as an error', async () => {
  const { fn } = mockExec({ 'bd close': { code: 1 } });
  const beads = new Beads(fn, new WriteQueue());
  await assert.rejects(beads.close('b1', 'done'));
});
