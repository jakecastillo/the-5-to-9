import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readGateMarker, readShiftState } from './state.ts';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'f9-state-'));
}

function writeState(dir: string): void {
  writeFileSync(
    join(dir, 'shift.local.md'),
    [
      '---',
      'goal: "ship the thing"',
      'branch: the-5-to-9/shift-20260617',
      'started: 2026-06-17T02:00:00Z',
      'engine: in-session',
      'status: active',
      'max_iterations: uncapped',
      '---',
      'ship the thing',
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'iteration.count'), '3\n');
}

test('readShiftState parses frontmatter, strips quotes, reads iteration', () => {
  const dir = freshDir();
  writeState(dir);
  const s = readShiftState(dir);
  expect(s.active).toBe(true);
  expect(s.goal).toBe('ship the thing');
  expect(s.branch).toBe('the-5-to-9/shift-20260617');
  expect(s.started).toBe('2026-06-17T02:00:00Z');
  expect(s.status).toBe('active');
  expect(s.maxIterations).toBe('uncapped');
  expect(s.iteration).toBe(3);
});

test('readShiftState on missing state file → inactive', () => {
  const dir = freshDir();
  const s = readShiftState(dir);
  expect(s.active).toBe(false);
  expect(s.goal).toBe('');
  expect(s.iteration).toBe(0);
});

test('readGateMarker parses a well-formed last-gate.txt', () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'last-gate.txt'), 'GREEN 18 2026-06-17T02:34:05Z\n');
  const g = readGateMarker(dir);
  expect(g).toEqual({ color: 'GREEN', count: 18, ts: '2026-06-17T02:34:05Z' });
});

test('readGateMarker rejects malformed markers → null', () => {
  const dir = freshDir();
  // missing file
  expect(readGateMarker(dir)).toBeNull();
  // color only
  writeFileSync(join(dir, 'last-gate.txt'), 'GREEN\n');
  expect(readGateMarker(dir)).toBeNull();
  // empty
  writeFileSync(join(dir, 'last-gate.txt'), '\n');
  expect(readGateMarker(dir)).toBeNull();
  // two tokens (no timestamp)
  writeFileSync(join(dir, 'last-gate.txt'), 'GREEN 18\n');
  expect(readGateMarker(dir)).toBeNull();
  // bad color
  writeFileSync(join(dir, 'last-gate.txt'), 'BLUE 18 2026-06-17T02:34:05Z\n');
  expect(readGateMarker(dir)).toBeNull();
  // non-numeric count
  writeFileSync(join(dir, 'last-gate.txt'), 'RED x 2026-06-17T02:34:05Z\n');
  expect(readGateMarker(dir)).toBeNull();
});

test('readGateMarker accepts RED', () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'last-gate.txt'), 'RED 4 2026-06-17T03:00:00Z\n');
  expect(readGateMarker(dir)).toEqual({ color: 'RED', count: 4, ts: '2026-06-17T03:00:00Z' });
});
