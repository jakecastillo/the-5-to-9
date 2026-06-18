import type { ExecFn, ExecResult } from '@the-5-to-9/driver/src/exec.ts';
import { expect, test } from 'vitest';
import { makeBeadsRead } from './beads-read.ts';

const WRITE_VERBS = ['create', 'update', 'close', 'claim', 'note', 'import', 'init', 'export'];

/** A stub exec mimicking tests/shift-dashboard-test.sh's bd stub. */
function stubExec(seen: string[]): ExecFn {
  return (cmd: string, args: string[]): Promise<ExecResult> => {
    seen.push([cmd, ...args].join(' '));
    if (cmd !== 'bd') return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    const verb = args[0];
    if (WRITE_VERBS.includes(verb)) {
      throw new Error(`WRITE_ATTEMPT: bd ${args.join(' ')}`);
    }
    const line = args.join(' ');
    let stdout = '';
    if (line === 'ready --json') {
      stdout = '[{"id":"r1","title":"Ready one"},{"id":"r2","title":"Ready two"}]';
    } else if (line === 'list --status=in_progress --json') {
      stdout = '[{"id":"ip1","title":"In progress one"}]';
    } else if (line === 'list --status=blocked --json') {
      stdout = '[{"id":"b1","title":"Blocked one"}]';
    } else if (line === 'count --status closed') {
      stdout = '5\n';
    } else {
      return Promise.reject(new Error(`bd stub: unsupported args: ${line}`));
    }
    return Promise.resolve({ stdout, stderr: '', code: 0 });
  };
}

test('ready() returns parsed beads', async () => {
  const seen: string[] = [];
  const beads = makeBeadsRead(stubExec(seen), { available: true });
  const ready = await beads.ready();
  expect(ready.map((b) => b.id)).toEqual(['r1', 'r2']);
  expect(ready[0].title).toBe('Ready one');
});

test('count(closed) returns 5', async () => {
  const beads = makeBeadsRead(stubExec([]), { available: true });
  expect(await beads.count('closed')).toBe(5);
});

test('readyCount counts occurrences (the fix), not bd count --status ready', async () => {
  const beads = makeBeadsRead(stubExec([]), { available: true });
  expect(await beads.readyCount()).toBe(2);
});

test('list(in_progress) and list(blocked)', async () => {
  const beads = makeBeadsRead(stubExec([]), { available: true });
  expect((await beads.list('in_progress')).map((b) => b.id)).toEqual(['ip1']);
  expect((await beads.list('blocked')).map((b) => b.id)).toEqual(['b1']);
});

test('no write verb is ever invoked', async () => {
  const seen: string[] = [];
  const beads = makeBeadsRead(stubExec(seen), { available: true });
  await beads.ready();
  await beads.list('in_progress');
  await beads.list('blocked');
  await beads.count('closed');
  await beads.readyCount();
  // Each recorded call is "bd <verb> ...". The verb is the token right after "bd";
  // assert that verb is never a write verb (substring checks would false-positive
  // on "--status closed" vs the "close" verb).
  for (const call of seen) {
    const verb = call.split(' ')[1];
    expect(WRITE_VERBS).not.toContain(verb);
  }
});

test('when bd is absent, reads degrade gracefully', async () => {
  const beads = makeBeadsRead(stubExec([]), { available: false });
  expect(beads.available()).toBe(false);
  expect(await beads.ready()).toEqual([]);
  expect(await beads.readyCount()).toBe(0);
  expect(await beads.count('closed')).toBe(0);
  expect(await beads.list('blocked')).toEqual([]);
});

// ── Bug 3: count() bd-failure must not masquerade as count 0 ─────────────────

test('count(): bd invocation failure returns null (not 0) — distinguishable from real empty backlog', async () => {
  // A failing bd invocation must NOT silently return 0 — the caller must be
  // able to distinguish "bd is broken" from "backlog is genuinely empty".
  const failing: ExecFn = () => Promise.reject(new Error('bd: command not found'));
  const beads = makeBeadsRead(failing, { available: true });
  // INVARIANT: null means "bd failed", 0 means "genuinely 0 beads".
  expect(await beads.count('closed')).toBeNull();
});

test('exec failure → ready/list degrade gracefully, count returns null', async () => {
  const failing: ExecFn = () => Promise.reject(new Error('boom'));
  const beads = makeBeadsRead(failing, { available: true });
  expect(await beads.ready()).toEqual([]);
  expect(await beads.readyCount()).toBe(0);
  // count returns null on failure — not 0 (the bug it previously masked).
  expect(await beads.count('closed')).toBeNull();
});
