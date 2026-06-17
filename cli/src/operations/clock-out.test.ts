import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readShiftState } from '../state.ts';
import { clockIn } from './clock-in.ts';
import { clockOut } from './clock-out.ts';

const STATE = '.claude/five-to-nine';

test('clockOut archives state, clears counters, returns the report', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-clockout-'));
  await clockIn('ship Y', { cwd: repo, noBranch: true });
  const dir = join(repo, STATE);
  writeFileSync(join(dir, 'iteration.count'), '4\n');

  const report = await clockOut({ cwd: repo });
  expect(report.iterations).toBe(4);
  expect(report.goal).toBe('ship Y');
  expect(report.started).not.toBe('');
  expect(report.ended).not.toBe('');

  // state archived, live state gone
  expect(existsSync(join(dir, 'shift.local.md'))).toBe(false);
  const archived = readdirSync(join(dir, 'archive'));
  expect(archived.some((f) => /^shift-.*\.md$/.test(f))).toBe(true);

  // counters cleared
  expect(existsSync(join(dir, 'iteration.count'))).toBe(false);
  expect(existsSync(join(dir, 'closed.snapshot'))).toBe(false);

  // shift no longer active
  expect(readShiftState(dir).active).toBe(false);
});

test('clockOut with no active shift returns a benign report', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'f9-clockout-none-'));
  const report = await clockOut({ cwd: repo });
  expect(report.iterations).toBe(0);
});
