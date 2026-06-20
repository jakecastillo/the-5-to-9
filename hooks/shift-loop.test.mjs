// The 5 to 9 — white-box tests for the Node-ported Stop-loop decision core.
// Covers the cap / drain / no-progress-stall / block-allow transitions and the
// frontmatter + max-iterations parsing that the bash shift-loop.sh encoded.
// Pure functions only — no filesystem, no `bd`, no stdin. Node 18+, zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  resolveMaxIter,
  decide,
  buildBlockReason,
  blockEnvelope,
} from './shift-loop.mjs';

test('parseFrontmatter reads keys between the first two --- fences, unquoting values', () => {
  const fm = parseFrontmatter(
    ['---', 'status: active', 'max_iterations: uncapped', 'goal: "ship it"', '---', 'body goal text'].join('\n'),
  );
  assert.equal(fm.status, 'active');
  assert.equal(fm.max_iterations, 'uncapped');
  assert.equal(fm.goal, 'ship it');
});

test('parseFrontmatter ignores body lines after the second fence', () => {
  const fm = parseFrontmatter(['---', 'status: active', '---', 'status: not-this'].join('\n'));
  assert.equal(fm.status, 'active');
});

test('resolveMaxIter: uncapped / none / 0 / empty all mean no ceiling (null)', () => {
  for (const raw of ['uncapped', 'none', '0', '', '   ', undefined]) {
    assert.equal(resolveMaxIter(raw, undefined), null, `raw=${JSON.stringify(raw)}`);
  }
});

test('resolveMaxIter: a positive integer is the cap', () => {
  assert.equal(resolveMaxIter('2', undefined), 2);
  assert.equal(resolveMaxIter('30', undefined), 30);
});

test('resolveMaxIter: non-numeric junk falls back to env, else 30', () => {
  assert.equal(resolveMaxIter('garbage', '12'), 12);
  assert.equal(resolveMaxIter('garbage', undefined), 30);
  assert.equal(resolveMaxIter('garbage', 'alsojunk'), 30);
});

test('decide: numeric cap stops the loop once iter exceeds it (allow)', () => {
  const d = decide({ iter: 6, maxIter: 2, ready: 5, closed: 3, prevClosed: 3, prevStall: 0, stallMax: 3, goal: 'g' });
  assert.equal(d.action, 'allow');
  assert.equal(d.reasonCode, 'cap');
});

test('decide: uncapped (maxIter null) keeps blocking past any ceiling', () => {
  const d = decide({ iter: 99, maxIter: null, ready: 5, closed: 3, prevClosed: 2, prevStall: 0, stallMax: 3, goal: 'g' });
  assert.equal(d.action, 'block');
  assert.match(d.reason, /iteration 99\/∞/);
});

test('decide: drained backlog (ready 0) stops the loop (allow), before any stall math', () => {
  const d = decide({ iter: 4, maxIter: null, ready: 0, closed: 3, prevClosed: 3, prevStall: 0, stallMax: 3, goal: 'g' });
  assert.equal(d.action, 'allow');
  assert.equal(d.reasonCode, 'drained');
  assert.equal(d.snapshot, null, 'drain must not write a stall snapshot');
});

test('decide: no-progress stall increments when closed is unchanged and stops at stallMax', () => {
  const d = decide({ iter: 5, maxIter: null, ready: 5, closed: 7, prevClosed: 7, prevStall: 2, stallMax: 3, goal: 'g' });
  assert.equal(d.action, 'allow');
  assert.equal(d.reasonCode, 'no-progress');
  assert.deepEqual(d.snapshot, { closed: 7, stall: 3 });
});

test('decide: progress (closed advanced) resets the stall counter and blocks', () => {
  const d = decide({ iter: 5, maxIter: null, ready: 5, closed: 8, prevClosed: 7, prevStall: 2, stallMax: 3, goal: 'g' });
  assert.equal(d.action, 'block');
  assert.deepEqual(d.snapshot, { closed: 8, stall: 0 });
});

test('decide: unavailable closed count (null) skips stall math and blocks with no snapshot', () => {
  const d = decide({ iter: 5, maxIter: null, ready: 5, closed: null, prevClosed: 7, prevStall: 2, stallMax: 3, goal: 'g' });
  assert.equal(d.action, 'block');
  assert.equal(d.snapshot, null);
});

test('buildBlockReason embeds iter/cap/ready/goal and the loop instructions', () => {
  const r = buildBlockReason({ iter: 3, maxIter: 30, ready: 4, goal: 'refine the TUI' });
  assert.match(r, /iteration 3\/30/);
  assert.match(r, /4 bead\(s\) ready/);
  assert.match(r, /Goal: refine the TUI/);
  assert.match(r, /bd ready --claim/);
});

test('blockEnvelope emits valid block JSON with the reason as a JSON string', () => {
  const env = blockEnvelope('line one\n"quoted"');
  const parsed = JSON.parse(env);
  assert.equal(parsed.decision, 'block');
  assert.equal(parsed.reason, 'line one\n"quoted"');
});
