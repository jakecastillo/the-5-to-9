import { BD_WRITE_DENY, IRREVERSIBLE_DENY } from './adapters/adapter.ts';
import type { Bead, WorkerSpec } from './types.ts';

/** Build the WorkerSpec for a role working a bead in a worktree. Shared by both ticks. */
export function specFor(bead: Bead, role: 'dealer' | 'auditor', worktree: string): WorkerSpec {
  return {
    beadId: bead.id,
    role,
    model: 'sonnet',
    worktree,
    systemPrompt:
      role === 'dealer'
        ? 'You are a Dealer: implement one bead test-first.'
        : 'You are the Floor Auditor: verify against acceptance; you did NOT implement this.',
    task: `Bead ${bead.id}. Emit a WorkerOutcome JSON.`,
    allowedTools: role === 'auditor' ? ['Read', 'Bash'] : ['Read', 'Edit', 'Write', 'Bash'],
    // Fire under bypassPermissions; the worker has no bd-write path regardless (spec §4.1).
    disallowedTools: [...BD_WRITE_DENY, ...IRREVERSIBLE_DENY],
  };
}
