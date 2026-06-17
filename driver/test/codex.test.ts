import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CodexAdapter, buildCodexArgs, parseCodexStdout } from '../src/adapters/codex.ts';
import type { ExecFn } from '../src/exec.ts';
import type { WorkerSpec } from '../src/types.ts';

const spec = (role: 'dealer' | 'auditor'): WorkerSpec => ({
  beadId: 'b1',
  role,
  systemPrompt: 'You are a worker.',
  task: 'do the bead',
  model: 'sonnet',
  allowedTools: [],
  disallowedTools: [],
  worktree: '/repo/wt-b1',
});

const opts = { schemaPath: '/tmp/schema.json', outPath: '/tmp/last.json', skipGitCheck: true };

// Mirrors the real JSONL shape observed in the Slice-0 spike (codex-cli 0.140.0).
function sampleStdout(outcome: object, usage = { input_tokens: 100, output_tokens: 34 }): string {
  return [
    JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: JSON.stringify(outcome) },
    }),
    JSON.stringify({ type: 'turn.completed', usage }),
  ].join('\n');
}

test('buildCodexArgs carries the pinned flags and maps role to sandbox', () => {
  const a = buildCodexArgs(spec('dealer'), opts).join(' ');
  assert.ok(
    a.startsWith('exec --json --output-schema /tmp/schema.json -C /repo/wt-b1 -s workspace-write'),
  );
  assert.ok(a.includes('--ephemeral') && a.includes('--ignore-user-config'));
  assert.ok(a.includes('--skip-git-repo-check') && a.includes('-o /tmp/last.json'));
  // auditor → read-only
  assert.ok(buildCodexArgs(spec('auditor'), opts).join(' ').includes('-s read-only'));
});

test('buildCodexArgs does NOT pass the Claude spec.model to codex', () => {
  assert.ok(!buildCodexArgs(spec('dealer'), opts).includes('sonnet'));
});

test('parseCodexStdout extracts the structured outcome and sums tokens', () => {
  const stdout = sampleStdout(
    { status: 'done', summary: 'implemented', filesTouched: ['a.ts'] },
    { input_tokens: 200, output_tokens: 34 },
  );
  const { outcome, tokens } = parseCodexStdout(stdout, spec('dealer'));
  assert.equal(outcome.beadId, 'b1');
  assert.equal(outcome.role, 'dealer');
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.costUsd, 0); // plan-metered
  assert.equal(tokens, 234);
});

test('parseCodexStdout surfaces a requestedAction from the structured outcome', () => {
  const stdout = sampleStdout({
    status: 'done',
    summary: 'surfaced an outward action',
    filesTouched: [],
    requestedAction: 'gh release create v1',
  });
  const { outcome } = parseCodexStdout(stdout, spec('dealer'));
  assert.equal(outcome.requestedAction, 'gh release create v1');
});

test('parseCodexStdout leaves requestedAction undefined when absent', () => {
  const stdout = sampleStdout({ status: 'done', summary: 'ok', filesTouched: [] });
  const { outcome } = parseCodexStdout(stdout, spec('dealer'));
  assert.equal(outcome.requestedAction, undefined);
});

test('parseCodexStdout throws when no agent_message is present', () => {
  const stdout = JSON.stringify({ type: 'turn.completed', usage: {} });
  assert.throws(() => parseCodexStdout(stdout, spec('dealer')), /no final agent_message/);
});

test('CodexAdapter.run shells codex and returns the parsed outcome', async () => {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    calls.push([cmd, ...args].slice(0, 2).join(' '));
    return {
      stdout: sampleStdout({ status: 'done', summary: 'ok', filesTouched: [] }),
      stderr: '',
      code: 0,
    };
  };
  const out = await new CodexAdapter(fn, opts).run(spec('dealer'));
  assert.equal(out.status, 'done');
  assert.ok(calls.some((c) => c === 'codex exec'));
});
