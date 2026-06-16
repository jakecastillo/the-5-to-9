import type { ExecFn } from '../exec.ts';
import { validateWorkerOutcome } from '../schema.ts';
import type { WorkerOutcome, WorkerSpec } from '../types.ts';
import type { WorkerAdapter } from './adapter.ts';

/** Build `claude -p` args for a worker. Flag names are PINNED from the Slice-0 spike. */
export function buildClaudeArgs(spec: WorkerSpec): string[] {
  return [
    '-p',
    spec.task,
    '--model',
    spec.model,
    '--append-system-prompt',
    spec.systemPrompt,
    '--output-format',
    'json',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    spec.allowedTools.join(','),
    '--disallowedTools',
    spec.disallowedTools.join(','),
    '--add-dir',
    spec.worktree,
  ];
}

/** Real Claude adapter (subscription via CLAUDE_CODE_OAUTH_TOKEN). Exec is injected for tests. */
export class ClaudeAdapter implements WorkerAdapter {
  constructor(private exec: ExecFn) {}

  async run(spec: WorkerSpec): Promise<WorkerOutcome> {
    const { stdout } = await this.exec('claude', buildClaudeArgs(spec), { cwd: spec.worktree });
    const parsed = JSON.parse(stdout);
    // The worker is prompted to emit a WorkerOutcome JSON as its final result.
    const inner = typeof parsed.result === 'string' ? JSON.parse(parsed.result) : parsed.result;
    const payload = inner ?? parsed;
    const v = validateWorkerOutcome({
      ...payload,
      costUsd: parsed.total_cost_usd ?? payload.costUsd ?? 0,
    });
    if (!v.ok) throw new Error(`worker outcome invalid: ${v.error}`);
    return v.value;
  }
}
