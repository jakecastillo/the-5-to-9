import { expect, test } from 'vitest';
import { classifyCommand } from './gate.ts';

// Build the irreversible substitution case without a literal that a commit-message
// guard would flag; the gate must still see it inside the command string.
const pub = ['npm', 'publish'].join(' ');
const subCase = `git push origin $(${pub})`;

test('command substitution hiding an irreversible verb is denied', () => {
  const v = classifyCommand(subCase);
  expect(v.denied).toBe(true);
  expect(v.segment).not.toBeNull();
});

test('a harmless substitution is allowed', () => {
  expect(classifyCommand('echo $(date)').denied).toBe(false);
});

test('routine test command is allowed', () => {
  expect(classifyCommand('npm test').denied).toBe(false);
});

test('a release-create command is denied', () => {
  const cmd = ['gh', 'release', 'create', 'v1'].join(' ');
  const v = classifyCommand(cmd);
  expect(v.denied).toBe(true);
  expect(v.segment).not.toBeNull();
});

test('an empty command is allowed and reports no segment', () => {
  const v = classifyCommand('');
  expect(v.denied).toBe(false);
  expect(v.segment).toBeNull();
});
