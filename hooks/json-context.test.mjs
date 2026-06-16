// The 5 to 9 — white-box tests for reusable hook JSON/context helpers.
// Zero dependencies; run with `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
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
