#!/usr/bin/env node
// The 5 to 9 — reusable JSON/additionalContext helpers for hooks.
// Zero dependencies; Node 18+.

export function jsonString(value) {
  return JSON.stringify(String(value));
}

export function additionalContextEnvelope(hookEventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName: String(hookEventName),
      additionalContext: String(additionalContext),
    },
  };
}

export function additionalContextJson(hookEventName, additionalContext) {
  return JSON.stringify(additionalContextEnvelope(hookEventName, additionalContext));
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', () => resolve(data));
    } catch {
      resolve(data);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const hookEventName = args[0] === 'additional-context' ? args[1] : args[0];
  if (!hookEventName) {
    process.stderr.write('json-context: usage: json-context.mjs [additional-context] <HookEventName>\n');
    process.exitCode = 64;
    return;
  }

  let note = '';
  try { note = await readStdin(); } catch { note = ''; }
  process.stdout.write(additionalContextJson(hookEventName, note) + '\n');
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => { process.exitCode = 1; });
}
