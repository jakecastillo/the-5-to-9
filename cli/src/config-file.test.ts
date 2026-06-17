import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { configPath, effectiveBackend, readConfig, setConfig } from './config-file.ts';

let prevXdg: string | undefined;
let prevBackend: string | undefined;

function unset(key: string): void {
  // Reflect.deleteProperty truly removes the env var (assigning undefined would
  // stringify to "undefined"); used over the `delete` operator for the linter.
  Reflect.deleteProperty(process.env, key);
}

beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevBackend = process.env.FIVE_TO_NINE_BACKEND;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'f9-cfg-'));
  unset('FIVE_TO_NINE_BACKEND');
});

afterEach(() => {
  if (prevXdg === undefined) unset('XDG_CONFIG_HOME');
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevBackend === undefined) unset('FIVE_TO_NINE_BACKEND');
  else process.env.FIVE_TO_NINE_BACKEND = prevBackend;
});

test('configPath lives under the XDG config home', () => {
  expect(configPath()).toBe(
    join(process.env.XDG_CONFIG_HOME as string, 'the-5-to-9', 'config.json'),
  );
});

test('setConfig then readConfig round-trips backend', () => {
  setConfig('backend', 'codex');
  expect(readConfig().backend).toBe('codex');
});

test('env FIVE_TO_NINE_BACKEND overrides the stored backend at the read site', () => {
  setConfig('backend', 'codex');
  expect(effectiveBackend()).toBe('codex');
  process.env.FIVE_TO_NINE_BACKEND = 'claude';
  expect(effectiveBackend()).toBe('claude');
});

test('setConfig coerces maxIterations to a number, keeps "uncapped"', () => {
  setConfig('maxIterations', '30');
  expect(readConfig().maxIterations).toBe(30);
  setConfig('maxIterations', 'uncapped');
  expect(readConfig().maxIterations).toBe('uncapped');
});

test('readConfig returns {} when no file exists', () => {
  expect(readConfig()).toEqual({});
});

test('unknown key throws a clear message', () => {
  expect(() => setConfig('nonsense', 'x')).toThrow(/unknown config key/i);
});

test('invalid backend value throws', () => {
  expect(() => setConfig('backend', 'gpt')).toThrow(/backend/i);
});
