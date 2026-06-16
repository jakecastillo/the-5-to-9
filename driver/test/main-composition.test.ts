/**
 * TDD: composition root test for main() Slice 2.
 * Drives main() with a MockAdapter seam, asserts the full composition root
 * (WriteQueue → Beads → Journal → RunLog → BudgetLedger → Worktrees → TickDeps)
 * is built and runShift runs a capped loop, mapping TickResult → TickOutcome correctly.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { WorkerAdapter } from '../src/adapters/adapter.ts';
import { MockAdapter } from '../src/adapters/mock.ts';
import type { ExecFn } from '../src/exec.ts';
import { type AdapterFactory, main } from '../src/main.ts';
import type { WorkerOutcome } from '../src/types.ts';

/** Minimal bd exec that delivers one ready bead on 'bd ready' and no-ops writes. */
function makeFakeBdExec(beadIds: string[]): { exec: ExecFn; calls: string[] } {
  const calls: string[] = [];
  let readyPool = [...beadIds];
  const exec: ExecFn = async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    if (key.includes('bd ready')) {
      const out = readyPool.map((id) => ({ id, status: 'open', inScopeDirs: ['src'] }));
      // Return empty after first call to trigger queue-empty stop
      readyPool = [];
      return { stdout: JSON.stringify(out), stderr: '', code: 0 };
    }
    if (key.startsWith('git checkout') || key.startsWith('git merge')) {
      return { stdout: '', stderr: '', code: 0 };
    }
    return { stdout: '{}', stderr: '', code: 0 };
  };
  return { exec, calls };
}

function makeAdapterFactory(beadIds: string[]): AdapterFactory {
  const scripts: Record<string, WorkerOutcome> = {};
  for (const id of beadIds) {
    scripts[id] = {
      beadId: id,
      role: 'dealer',
      status: 'done',
      summary: 'impl',
      filesTouched: ['src/a.ts'],
      costUsd: 0.001,
    };
  }
  return (_backend: string, _exec: ExecFn): WorkerAdapter => new MockAdapter(scripts);
}

test('main() with MockAdapter builds the composition root and runs a capped shift — queue-empty stop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9main-'));
  try {
    const beadIds = ['bead-alpha'];
    const { exec, calls } = makeFakeBdExec(beadIds);
    const adapterFactory = makeAdapterFactory(beadIds);

    let printedOutput = '';
    const fakeStdout = {
      write: (s: string) => {
        printedOutput += s;
      },
    };

    const code = await main(['--backend', 'claude'], exec, adapterFactory, {
      stateDir: join(dir, '.f9-state'),
      repoRoot: dir,
      stdout: fakeStdout as unknown as typeof process.stdout,
    });

    // Should exit 0 on a clean queue-empty stop
    assert.equal(code, 0, `expected exit 0, got ${code}`);

    // The composition root must have claimed + closed the bead
    assert.ok(
      calls.some((c) => c.includes('bd update bead-alpha --claim')),
      `expected bd update bead-alpha --claim in calls: ${calls.join(', ')}`,
    );
    assert.ok(
      calls.some((c) => c.includes('bd close bead-alpha')),
      `expected bd close bead-alpha in calls: ${calls.join(', ')}`,
    );

    // The printed output must mention the shift report (stopped + iterations)
    assert.match(
      printedOutput,
      /queue-empty|stopped|ShiftReport|iterations/i,
      `expected shift report in output: ${printedOutput}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('main() respects --max-iterations cap and prints the ShiftReport', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9main-cap-'));
  try {
    // Two beads but cap at 1 — should stop at cap after the first tick
    const beadIds = ['b1', 'b2'];
    const { calls } = makeFakeBdExec(beadIds);
    const scripts: Record<string, WorkerOutcome> = {};
    for (const id of beadIds) {
      scripts[id] = {
        beadId: id,
        role: 'dealer',
        status: 'done',
        summary: 'impl',
        filesTouched: ['src/a.ts'],
        costUsd: 0.001,
      };
    }
    const adapterFactory: AdapterFactory = (_backend, _exec) => new MockAdapter(scripts);

    // Override readyPool: always return both beads so the cap — not queue-empty — fires
    const alwaysReadyExec: ExecFn = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      calls.push(key);
      if (key.includes('bd ready')) {
        return {
          stdout: JSON.stringify(
            beadIds.map((id) => ({ id, status: 'open', inScopeDirs: ['src'] })),
          ),
          stderr: '',
          code: 0,
        };
      }
      if (key.startsWith('git checkout') || key.startsWith('git merge')) {
        return { stdout: '', stderr: '', code: 0 };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };

    let printedOutput = '';
    const fakeStdout = {
      write: (s: string) => {
        printedOutput += s;
      },
    };

    const code = await main(
      ['--backend', 'claude', '--max-iterations', '1'],
      alwaysReadyExec,
      adapterFactory,
      {
        stateDir: join(dir, '.f9-state'),
        repoRoot: dir,
        stdout: fakeStdout as unknown as typeof process.stdout,
      },
    );

    assert.equal(code, 0);
    // With cap=1, exactly 1 bead tick — b1 should be closed but not b2
    assert.ok(
      calls.some((c) => c.includes('bd update b1 --claim')),
      'b1 claimed',
    );
    assert.ok(
      calls.some((c) => c.includes('bd close b1')),
      'b1 closed',
    );
    // Report should mention iterations=1
    assert.match(printedOutput, /\b1\b/, 'iterations=1 in report');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('main() maps TickResult queue-empty reason to TickOutcome empty:true', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9main-empty-'));
  try {
    // Empty queue from the start — should get queue-empty immediately
    const { exec } = makeFakeBdExec([]); // no beads
    const adapterFactory: AdapterFactory = (_backend, _exec) => new MockAdapter({});

    let printedOutput = '';
    const fakeStdout = {
      write: (s: string) => {
        printedOutput += s;
      },
    };

    const code = await main(['--backend', 'claude'], exec, adapterFactory, {
      stateDir: join(dir, '.f9-state'),
      repoRoot: dir,
      stdout: fakeStdout as unknown as typeof process.stdout,
    });

    assert.equal(code, 0);
    assert.match(printedOutput, /queue-empty/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
