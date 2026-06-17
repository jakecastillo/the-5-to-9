import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BD_WRITE_DENY, IRREVERSIBLE_DENY } from '../src/adapters/adapter.ts';
import { ClaudeAdapter, buildClaudeArgs } from '../src/adapters/claude.ts';
import { MockAdapter } from '../src/adapters/mock.ts';
import type { ExecFn } from '../src/exec.ts';
import type { WorkerSpec } from '../src/types.ts';

const spec: WorkerSpec = {
  beadId: 'b1',
  role: 'dealer',
  systemPrompt: 'You are a Dealer.',
  task: 'do it',
  model: 'sonnet',
  allowedTools: ['Read', 'Edit', 'Bash'],
  disallowedTools: [...BD_WRITE_DENY, ...IRREVERSIBLE_DENY],
  worktree: '/tmp/wt',
};

test('deny-rules include bd writes and force-push', () => {
  assert.ok(BD_WRITE_DENY.some((r) => r.includes('bd create')));
  assert.ok(IRREVERSIBLE_DENY.some((r) => r.includes('push') && r.includes('force')));
});

test('Claude args carry model, output-format json, and disallowedTools', () => {
  const args = buildClaudeArgs(spec);
  assert.ok(args.includes('--model') && args.includes('sonnet'));
  assert.ok(args.join(' ').includes('--output-format json'));
  assert.ok(args.join(' ').includes('--disallowedTools'));
  assert.ok(args.join(' ').includes('Bash(bd create*)'));
});

test('ClaudeAdapter.run surfaces a requestedAction from the worker outcome', async () => {
  const fn: ExecFn = async () => ({
    stdout: JSON.stringify({
      total_cost_usd: 0.03,
      result: JSON.stringify({
        beadId: 'b1',
        role: 'dealer',
        status: 'done',
        summary: 'surfaced an outward action',
        filesTouched: [],
        requestedAction: 'gh release create v1',
      }),
    }),
    stderr: '',
    code: 0,
  });
  const out = await new ClaudeAdapter(fn).run(spec);
  assert.equal(out.requestedAction, 'gh release create v1');
  assert.equal(out.costUsd, 0.03);
});

test('MockAdapter returns the scripted outcome', async () => {
  const m = new MockAdapter({
    b1: {
      beadId: 'b1',
      role: 'dealer',
      status: 'done',
      summary: 'ok',
      filesTouched: ['a.ts'],
      costUsd: 0.02,
    },
  });
  const out = await m.run(spec);
  assert.equal(out.status, 'done');
  assert.equal(out.costUsd, 0.02);
});
