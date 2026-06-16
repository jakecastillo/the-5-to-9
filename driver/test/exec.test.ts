import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realExec } from '../src/exec.ts';

// Each test gets a hard timeout so a stdin hang (the regression this guards)
// fails loudly instead of stalling the whole suite.
const TIMEOUT = 5000;

test('realExec returns stdout and exit 0 for a normal command', { timeout: TIMEOUT }, async () => {
  const { stdout, code } = await realExec('node', ['-e', 'process.stdout.write("ok")']);
  assert.equal(code, 0);
  assert.ok(stdout.includes('ok'));
});

test(
  'realExec gives a stdin-reading child immediate EOF instead of hanging',
  { timeout: TIMEOUT },
  async () => {
    // `cat` with no args copies stdin to stdout. If stdin were left open it would
    // block forever; with stdin ignored it sees EOF, exits 0, and emits nothing.
    const { stdout, code } = await realExec('cat', []);
    assert.equal(code, 0);
    assert.equal(stdout, '');
  },
);

test('realExec rejects on a nonzero exit', { timeout: TIMEOUT }, async () => {
  await assert.rejects(() => realExec('node', ['-e', 'process.exit(3)']), /exited 3/);
});
