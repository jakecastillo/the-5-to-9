// The 5 to 9 — white-box tests for reusable hook JSON/context helpers.
// Zero dependencies; run with `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jsonString, additionalContextJson } from './json-context.mjs';

const ROUND_TRIP_CASES = [
  '',
  'plain note',
  'has "quotes"',
  'back\\slash\\here',
  'line\nbreak',
  'ctl\ttab',
];

for (const value of ROUND_TRIP_CASES) {
  test(`jsonString round-trips ${JSON.stringify(value)}`, () => {
    const encoded = jsonString(value);
    assert.equal(encoded.startsWith('"'), true);
    assert.equal(encoded.endsWith('"'), true);
    assert.equal(JSON.parse(encoded), value);
  });
}

test('additionalContextJson builds a hookSpecificOutput envelope', () => {
  const note = 'messy "quotes" and \\backslash\nand tab\ttoo';
  const parsed = JSON.parse(additionalContextJson('SessionStart', note));

  assert.deepEqual(parsed, {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: note,
    },
  });
});

test('json-context.sh dispatches to node when node is available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f9-json-context-'));
  const marker = join(dir, 'node-argv.txt');
  const fakeNode = join(dir, 'node');
  writeFileSync(fakeNode, [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$@" > "$F9_NODE_MARKER"',
    'exec "$REAL_NODE" "$@"',
    '',
  ].join('\n'));
  chmodSync(fakeNode, 0o755);

  const note = 'from node "path"';
  const result = spawnSync('bash', ['hooks/json-context.sh', 'UserPromptSubmit'], {
    cwd: process.cwd(),
    input: note,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH || ''}`,
      REAL_NODE: process.execPath,
      F9_NODE_MARKER: marker,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(marker, 'utf8'), /hooks\/json-context\.mjs/);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, note);
});

test('json-context.sh falls back to bash f9_json_string when node is unavailable', () => {
  const note = 'fallback "quotes" \\backslash\nline\twith tab';
  const result = spawnSync('bash', ['hooks/json-context.sh', 'SessionStart'], {
    cwd: process.cwd(),
    input: note,
    encoding: 'utf8',
    env: {
      ...process.env,
      F9_JSON_CONTEXT_SKIP_NODE: '1',
      F9_NO_JQ: '1',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: note,
    },
  });
});

// ---- user-prompt-submit.sh tests ----

const UPS_TRIGGERS = [
  'clock in',
  'Clock In',
  'night shift',
  'Night Shift',
  '5 to 9',
];

for (const trigger of UPS_TRIGGERS) {
  test(`user-prompt-submit.sh emits additionalContext for trigger "${trigger}" via node`, () => {
    // Provide JSON payload (with jq-parseable .prompt) as would Claude Code send
    const payload = JSON.stringify({ prompt: trigger });
    const result = spawnSync('bash', ['hooks/user-prompt-submit.sh'], {
      cwd: process.cwd(),
      input: payload,
      encoding: 'utf8',
      env: {
        ...process.env,
        // No F9_JSON_CONTEXT_SKIP_NODE so node path is used
      },
    });

    assert.equal(result.status, 0, `exit non-zero: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string');
    assert.ok(parsed.hookSpecificOutput.additionalContext.length > 0, 'additionalContext must be non-empty');
  });
}

test('user-prompt-submit.sh routes through json-context.sh (node path) when node is present', () => {
  // Use a fake node that records the args to confirm dispatch
  const dir = mkdtempSync(join(tmpdir(), 'f9-ups-node-'));
  const marker = join(dir, 'node-argv.txt');
  const fakeNode = join(dir, 'node');
  writeFileSync(fakeNode, [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$@" > "$F9_NODE_MARKER"',
    'exec "$REAL_NODE" "$@"',
    '',
  ].join('\n'));
  chmodSync(fakeNode, 0o755);

  const payload = JSON.stringify({ prompt: 'clock in please' });
  const result = spawnSync('bash', ['hooks/user-prompt-submit.sh'], {
    cwd: process.cwd(),
    input: payload,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH || ''}`,
      REAL_NODE: process.execPath,
      F9_NODE_MARKER: marker,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  // The fake node should have been invoked with json-context.mjs
  assert.ok(existsSync(marker), 'fake node was never invoked — did not route through json-context.sh');
  const argv = readFileSync(marker, 'utf8');
  assert.match(argv, /hooks\/json-context\.mjs/, `expected json-context.mjs in argv, got: ${argv}`);
  // Output must still be valid JSON
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
});

test('user-prompt-submit.sh falls back to bash f9_json_string when node is absent', () => {
  const payload = JSON.stringify({ prompt: 'night shift please' });
  const result = spawnSync('bash', ['hooks/user-prompt-submit.sh'], {
    cwd: process.cwd(),
    input: payload,
    encoding: 'utf8',
    env: {
      ...process.env,
      F9_JSON_CONTEXT_SKIP_NODE: '1',
      F9_NO_JQ: '1',
    },
  });

  assert.equal(result.status, 0, `should always exit 0, stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(parsed.hookSpecificOutput.additionalContext.length > 0);
});

test('user-prompt-submit.sh exits 0 and emits nothing for non-trigger input', () => {
  const payload = JSON.stringify({ prompt: 'what is the weather today?' });
  const result = spawnSync('bash', ['hooks/user-prompt-submit.sh'], {
    cwd: process.cwd(),
    input: payload,
    encoding: 'utf8',
    env: { ...process.env },
  });

  assert.equal(result.status, 0, `should always exit 0`);
  assert.equal(result.stdout.trim(), '', 'non-trigger should emit nothing');
});

const ADVERSARIAL_NOTES_CASES = [
  'plain',
  'has "double quotes"',
  'back\\slash',
  'new\nline',
  'tab\there',
  '"quotes" and \\backslash\nand tab\ttoo',
];

for (const note of ADVERSARIAL_NOTES_CASES) {
  test(`user-prompt-submit.sh additionalContext JSON parses for note: ${JSON.stringify(note)}`, () => {
    // We test this by directly calling json-context.sh with our note (same codepath UPS will use)
    const result = spawnSync('bash', ['hooks/json-context.sh', 'UserPromptSubmit'], {
      cwd: process.cwd(),
      input: note,
      encoding: 'utf8',
      env: { ...process.env },
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.hookSpecificOutput.additionalContext, note,
      `round-trip failed for ${JSON.stringify(note)}`);
  });
}
