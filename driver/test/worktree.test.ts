import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecFn } from '../src/exec.ts';
import { Worktrees } from '../src/worktree.ts';

function recorder(impl?: (key: string) => { stdout?: string; throws?: boolean }): {
  fn: ExecFn;
  calls: string[];
} {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    const r = impl?.(key) ?? {};
    if (r.throws) throw new Error(`nonzero: ${key}`);
    return { stdout: r.stdout ?? '', stderr: '', code: 0 };
  };
  return { fn, calls };
}

test('add() shells `git worktree add -b <branch> <path> HEAD` and returns the path', async () => {
  const { fn, calls } = recorder();
  const wt = new Worktrees(fn, '/repo');
  const path = await wt.add('b1', 'shift/b1');
  assert.equal(path, '/repo/.f9-worktrees/wt-b1');
  assert.ok(calls.some((c) => c === 'git worktree add -b shift/b1 /repo/.f9-worktrees/wt-b1 HEAD'));
});

test('remove() shells `git worktree remove --force <path>`', async () => {
  const { fn, calls } = recorder();
  const wt = new Worktrees(fn, '/repo');
  await wt.remove('/repo/.f9-worktrees/wt-b1');
  assert.ok(calls.some((c) => c === 'git worktree remove --force /repo/.f9-worktrees/wt-b1'));
});

test('mergesClean() is true when merge-tree succeeds without conflict', async () => {
  const { fn } = recorder(() => ({ stdout: 'abc123treeoid' }));
  const wt = new Worktrees(fn, '/repo');
  assert.equal(await wt.mergesClean('main', 'shift/b1'), true);
});

test('mergesClean() is false on a nonzero exit (real conflict)', async () => {
  const { fn } = recorder((k) => (k.startsWith('git merge-tree') ? { throws: true } : {}));
  const wt = new Worktrees(fn, '/repo');
  assert.equal(await wt.mergesClean('main', 'shift/b1'), false);
});

test('mergesClean() is false when the output reports a CONFLICT', async () => {
  const { fn } = recorder(() => ({ stdout: 'CONFLICT (content): Merge conflict in src/a.ts' }));
  const wt = new Worktrees(fn, '/repo');
  assert.equal(await wt.mergesClean('main', 'shift/b1'), false);
});

test('merge() checks out base then fast-forward merges the branch', async () => {
  const { fn, calls } = recorder();
  const wt = new Worktrees(fn, '/repo');
  await wt.merge('main', 'shift/b1');
  assert.ok(
    calls.some((c) => c === 'git checkout main'),
    'must checkout base',
  );
  assert.ok(
    calls.some((c) => c === 'git merge --ff-only shift/b1'),
    'must ff-merge branch',
  );
});

test('merge() falls back to --no-ff when --ff-only fails', async () => {
  const { fn, calls } = recorder((k) =>
    k === 'git merge --ff-only shift/b1' ? { throws: true } : {},
  );
  const wt = new Worktrees(fn, '/repo');
  await wt.merge('main', 'shift/b1');
  assert.ok(
    calls.some((c) => c === 'git merge --no-ff shift/b1'),
    'must fall back to --no-ff',
  );
});

test('merge() rejects when both merge strategies fail (conflict)', async () => {
  const { fn } = recorder((k) => {
    if (k.startsWith('git merge')) return { throws: true };
    return {};
  });
  const wt = new Worktrees(fn, '/repo');
  await assert.rejects(() => wt.merge('main', 'shift/b1'), /merge failed/);
});
