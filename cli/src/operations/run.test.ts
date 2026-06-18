import type { SpawnOptions } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { type SpawnFn, startRun } from './run.ts';

interface FakeChild {
  pid: number;
  unrefCalled: boolean;
}

function fakeSpawn() {
  const calls: { cmd: string; args: string[]; opts: SpawnOptions }[] = [];
  const child: FakeChild = { pid: 4242, unrefCalled: false };
  const spawn: SpawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return {
      pid: child.pid,
      unref() {
        child.unrefCalled = true;
      },
    };
  };
  return { spawn, calls, child };
}

test('startRun spawns the driver detached, forwards flags, returns a journal path', async () => {
  const { spawn, calls, child } = fakeSpawn();
  const stateDir = mkdtempSync(join(tmpdir(), 'f9-run-'));
  const handle = await startRun(
    { maxIterations: 3, backend: 'claude' },
    { spawn, stateDir, branch: 'the-5-to-9/shift-20260617' },
  );

  expect(calls.length).toBe(1);
  const call = calls[0];
  // Spawns node (the driver entry runs under node).
  expect(call.cmd).toBe('node');
  // Detached + ignored stdio so the parent can exit without killing the run.
  expect(call.opts.detached).toBe(true);
  expect(call.opts.stdio).toBe('ignore');
  expect(child.unrefCalled).toBe(true);

  // Flags forwarded.
  const flat = call.args.join(' ');
  expect(flat).toContain('--max-iterations 3');
  expect(flat).toContain('--backend claude');

  // Returns a detached handle with the pid and a journal path under runs/<branch>/.
  expect(handle.pid).toBe(4242);
  expect(handle.detached).toBe(true);
  expect(handle.journalPath).toContain(join('runs', 'the-5-to-9/shift-20260617'));
  expect(handle.journalPath.startsWith(stateDir)).toBe(true);
});

test('startRun without maxIterations omits the cap flag (uncapped run)', async () => {
  const { spawn, calls } = fakeSpawn();
  const stateDir = mkdtempSync(join(tmpdir(), 'f9-run-'));
  await startRun({ backend: 'codex' }, { spawn, stateDir, branch: 'main' });
  const flat = calls[0].args.join(' ');
  expect(flat).toContain('--backend codex');
  expect(flat).not.toContain('--max-iterations');
});

// ── Bug 1: safeBranch empty-guard ────────────────────────────────────────────

test('safeBranch: empty branch name → journal path uses "current" (no empty segment)', async () => {
  const { spawn } = fakeSpawn();
  const stateDir = mkdtempSync(join(tmpdir(), 'f9-run-'));
  const handle = await startRun({ backend: 'claude' }, { spawn, stateDir, branch: '' });
  expect(handle.journalPath).toContain(join('runs', 'current'));
});

test('safeBranch: undefined branch → journal path uses "current"', async () => {
  // When deps.branch is omitted (undefined), safeBranch should fall back to 'current'
  // not an empty string that collides with other branches.
  const { spawn } = fakeSpawn();
  const stateDir = mkdtempSync(join(tmpdir(), 'f9-run-'));
  // branch is omitted → deps.branch ?? 'current' feeds 'current' into safeBranch
  const handle = await startRun({ backend: 'claude' }, { spawn, stateDir });
  expect(handle.journalPath).toContain(join('runs', 'current'));
});
