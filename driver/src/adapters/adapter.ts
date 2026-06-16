import type { WorkerOutcome, WorkerSpec } from '../types.ts';

/**
 * Deny-rules that FIRE under bypassPermissions (spec §4.1/§7). Under bypass, allowedTools does
 * NOT constrain and canUseTool is never reached — so these deny-rules + the PreToolUse hook are
 * the structural guarantees, alongside workers simply having no bd-write code path.
 */
export const BD_WRITE_DENY = [
  'Bash(bd create*)',
  'Bash(bd update*)',
  'Bash(bd close*)',
  'Bash(bd claim*)',
  'Bash(bd note*)',
  'Bash(bd dep*)',
];

export const IRREVERSIBLE_DENY = ['Bash(git push --force*)', 'Bash(git push -f*)'];

export interface WorkerAdapter {
  run(spec: WorkerSpec): Promise<WorkerOutcome>;
}
