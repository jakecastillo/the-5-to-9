import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { clockIn } from './clock-in.ts';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'f9-clockin-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'crew@five.to.nine']);
  git(dir, ['config', 'user.name', 'Night Crew']);
  git(dir, ['checkout', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'README.md'), '# temp\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'initial']);
  return dir;
}

const STATE = '.claude/five-to-nine';

test('clockIn writes state, resets counters, and switches to a shift branch', async () => {
  const repo = freshRepo();
  const res = await clockIn('ship X', { cwd: repo });

  const stateFile = join(repo, STATE, 'shift.local.md');
  expect(existsSync(stateFile)).toBe(true);
  const body = readFileSync(stateFile, 'utf8');
  expect(body).toMatch(/status: active/);
  expect(body).toMatch(/goal: "ship X"/);
  expect(body).toMatch(/max_iterations: uncapped/);
  expect(body).toMatch(/engine: in-session/);
  // body line after frontmatter is the goal
  expect(body.trimEnd().endsWith('ship X')).toBe(true);

  expect(readFileSync(join(repo, STATE, 'iteration.count'), 'utf8').trim()).toBe('0');
  expect(existsSync(join(repo, STATE, 'closed.snapshot'))).toBe(false);

  const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  expect(branch).toMatch(/^the-5-to-9\/shift-\d{8}$/);
  expect(res.branch).toBe(branch);
  expect(res.warnings).toEqual([]);
});

test('clockIn escapes embedded quotes in the goal', async () => {
  const repo = freshRepo();
  await clockIn('ship "the" thing', { cwd: repo });
  const body = readFileSync(join(repo, STATE, 'shift.local.md'), 'utf8');
  expect(body).toMatch(/goal: "ship \\"the\\" thing"/);
});

test('clockIn --noBranch skips branch ops, stays on main', async () => {
  const repo = freshRepo();
  const res = await clockIn('ship X', { cwd: repo, noBranch: true });
  expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
  expect(existsSync(join(repo, STATE, 'shift.local.md'))).toBe(true);
  expect(res.branch).toBe('(current)');
});

test('clockIn already on a shift branch keeps it', async () => {
  const repo = freshRepo();
  git(repo, ['checkout', '-q', '-b', 'the-5-to-9/shift-20260101']);
  const res = await clockIn('ship X', { cwd: repo });
  expect(res.branch).toBe('the-5-to-9/shift-20260101');
});

test('clockIn in a non-git dir warns and still writes state (no throw)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f9-clockin-nogit-'));
  const res = await clockIn('ship X', { cwd: dir });
  expect(existsSync(join(dir, STATE, 'shift.local.md'))).toBe(true);
  expect(res.warnings.length).toBeGreaterThan(0);
  expect(res.branch).toBe('(current)');
});
