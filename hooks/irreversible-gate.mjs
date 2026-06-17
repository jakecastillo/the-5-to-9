#!/usr/bin/env node
// The 5 to 9 — PreToolUse gate (Node port). Blocks irreversible OUTWARD actions;
// everything reversible proceeds. Reads PreToolUse JSON on stdin, emits a deny
// decision (JSON) on a match, else nothing. Never throws — a crashing gate must
// not break the host. Zero dependencies; runs on Node 18+.
//
// Behaviour is identical to hooks/irreversible-gate.sh and is pinned by the
// language-agnostic corpus tests/gate-cases.txt (run via tests/gate-test.sh).
// The classifier is exported for white-box unit tests (hooks/gate.test.mjs).

// Deny-list of irreversible OUTWARD tool actions (case-insensitive). Each rule is
// anchored at a word boundary so it matches the tool, not a substring. Tuned to
// NOT block normal shift work (npm test, make build, git push origin <branch>).
const TOOL_SOURCES = [
  '(^| )(npm|pnpm|yarn) +publish( |$)',
  '(^| )(npm|pnpm|yarn) +run +deploy( |$)',
  '(^| )make +deploy( |$)',
  '(^| )cargo +publish( |$)',
  '(^| )gem +push( |$)',
  '(^| )twine +upload( |$)',
  '(^| )poetry +publish( |$)',
  '(^| )(mvn|gradle) +(deploy|publish)( |$)',
  '(^| )dotnet +nuget +push( |$)',
  '(^| )(gh|hub) +release +(create|delete|edit)( |$)',
  '(^| )gh +repo +(delete|archive)( |$)',
  '(^| )gh +secret +(delete|remove)( |$)',
  '(^| )gh +gist +delete( |$)',
  '(^| )docker +push( |$)',
  '(^| )(kubectl|k) +(apply|create|replace|delete|patch|rollout|scale|edit)( |$)',
  '(^| )helm +(install|upgrade|uninstall|delete)( |$)',
  '(^| )terraform +(apply|destroy)( |$)',
  '(^| )pulumi +(up|destroy)( |$)',
  '(^| )cdk +(deploy|destroy)( |$)',
  '(^| )wrangler +(deploy|publish)( |$)',
  '(^| )pm2 +deploy( |$)',
  '(^| )railway +up( |$)',
  '(^| )ansible-playbook( |$)',
  '(^| )(serverless|sls) +deploy( |$)',
  '(^| )netlify +deploy( |$)',
  '(^| )firebase +deploy( |$)',
  '(^| )(flyctl|fly) +deploy( |$)',
  '(^| )vercel( +[^ ]+)* +(--prod|deploy)( |$)',
  '(^| )gcloud( +[^ ]+)* +deploy( |$)',
  '(^| )heroku +(deploy|releases|pg:reset)( |$)',
  '(^| )aws +(deploy|s3 +(rm|rb)|s3api +delete-[a-z]+|ecr +batch-delete-image|secretsmanager +(delete-secret|rotate-secret)|rds +delete-db[a-z-]*)( |$)',
  '(^| )supabase +db +reset( |$)',
  '(^| )vault +(kv +)?(delete|destroy)( |$)',
  '(^| )dropdb( |$)',
  '(^| )drop +database( |$)',
];
const TOOL_RE = new RegExp(TOOL_SOURCES.join('|'), 'i');

// git push: force / delete / mirror / +refspec / :refspec — tolerant of leading
// global options (git -C <dir>, git -c k=v, git --git-dir=...). Plain --tags is
// reversible and NOT blocked (tag deletion is caught by --delete / :refspec).
const GIT_PUSH_RE = /(^| )git( +-[^ ]+( +[^ -][^ ]*)?)* +push( |$)/i;
const GIT_FORCE_RE = /(--force|--force-with-lease|--mirror|--delete|(^| )-[a-z]*f( |$)| :[a-z0-9_.\/-]+| \+[a-z0-9_.\/-]+)/i;

function normalize(seg) {
  return String(seg).replace(/\s+/g, ' ').replace(/^ | $/g, '');
}

export function segmentIsIrreversible(seg) {
  const n = normalize(seg);
  if (!n) return false;
  if (GIT_PUSH_RE.test(n) && GIT_FORCE_RE.test(n)) return true;
  return TOOL_RE.test(n);
}

// Split on shell separators (&& || ; | &) AND command-substitution delimiters
// ($( ) and backtick) so a keyword inside a substitution can't escape classification.
// Each resulting fragment is classified independently; the first irreversible one wins.
export function firstDenySegment(cmd) {
  // First split on $( and backtick to expose substitution contents, then on ) to
  // close each substitution scope, then on the usual shell separators.
  for (const part of String(cmd).split(/\$\(|`|\)|\|\||&&|;|\||&/)) {
    if (segmentIsIrreversible(part)) return normalize(part);
  }
  return null;
}

export function extractCommand(payload) {
  try {
    const j = JSON.parse(payload);
    return (j && j.tool_input && (j.tool_input.command ?? j.tool_input.cmd)) || '';
  } catch {
    return '';
  }
}

export function denyDecision(seg) {
  const reason =
    'The 5 to 9 gate: this looks like an irreversible OUTWARD action (deploy / ' +
    'publish / force-push / delete remote data / destroy or rotate secrets). The ' +
    'night crew stops here on purpose — a human must review and run it manually. ' +
    'Everything reversible proceeds; this does not. Flagged command segment: ' + seg;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
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
  let payload = '';
  try { payload = await readStdin(); } catch { payload = ''; }
  const cmd = extractCommand(payload);
  if (!cmd) return;
  const seg = firstDenySegment(cmd);
  if (seg) process.stdout.write(JSON.stringify(denyDecision(seg)) + '\n');
}

// Run only as a script, not when imported by the test file.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {});
}
