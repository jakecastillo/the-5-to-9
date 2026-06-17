import type { ExecFn } from '../exec.ts';
import { validateWorkerOutcome } from '../schema.ts';
import type { WorkerOutcome, WorkerSpec } from '../types.ts';
import type { WorkerAdapter } from './adapter.ts';

export interface CodexOptions {
  /** Path to a JSON Schema describing the worker's final response shape. */
  schemaPath: string;
  outPath?: string;
  /** Codex-specific model (NOT the Claude `spec.model`); omit to use the plan default. */
  model?: string;
  skipGitCheck?: boolean;
}

/**
 * Build `codex exec` args — flags PINNED + live-verified in the Slice-0 spike (codex-cli 0.140.0,
 * ChatGPT-plan auth). Codex uses sandbox modes instead of allow/deny tool lists; the Auditor runs
 * read-only, the Dealer workspace-write. The real exec must redirect stdin from /dev/null.
 */
export function buildCodexArgs(spec: WorkerSpec, o: CodexOptions): string[] {
  const sandbox = spec.role === 'auditor' ? 'read-only' : 'workspace-write';
  const args = [
    'exec',
    '--json',
    '--output-schema',
    o.schemaPath,
    '-C',
    spec.worktree,
    '-s',
    sandbox,
    '--ephemeral',
    '--ignore-user-config',
  ];
  if (o.skipGitCheck) args.push('--skip-git-repo-check');
  if (o.outPath) args.push('-o', o.outPath);
  if (o.model) args.push('-m', o.model);
  args.push(`${spec.systemPrompt}\n\n${spec.task}`);
  return args;
}

interface CodexEvent {
  type?: string;
  item?: { type?: string; text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Parse codex `--json` JSONL stdout → a WorkerOutcome + token count. The final structured message
 * is the last `item.completed` agent_message (its `.text` is the schema-shaped JSON); token usage
 * is on `turn.completed`. beadId/role come from the spec; costUsd is 0 (plan-metered, token-tracked).
 */
export function parseCodexStdout(
  stdout: string,
  spec: WorkerSpec,
): { outcome: WorkerOutcome; tokens: number } {
  let finalText: string | undefined;
  let tokens = 0;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let e: CodexEvent;
    try {
      e = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }
    if (
      e.type === 'item.completed' &&
      e.item?.type === 'agent_message' &&
      typeof e.item.text === 'string'
    ) {
      finalText = e.item.text;
    }
    if (e.type === 'turn.completed' && e.usage) {
      tokens = (e.usage.input_tokens ?? 0) + (e.usage.output_tokens ?? 0);
    }
  }
  if (!finalText) throw new Error('codex: no final agent_message found in JSONL output');
  const payload = JSON.parse(finalText) as Record<string, unknown>;
  const v = validateWorkerOutcome({
    beadId: spec.beadId,
    role: spec.role,
    status: payload.status,
    summary: payload.summary,
    filesTouched: payload.filesTouched ?? [],
    costUsd: 0,
    // Surface an outward action the worker could not run (Phase 1c). The schema
    // validates it is a string when present; absent stays undefined.
    requestedAction: payload.requestedAction,
  });
  if (!v.ok) throw new Error(`codex outcome invalid: ${v.error}`);
  return { outcome: v.value, tokens };
}

/** Codex worker adapter (ChatGPT-plan auth). Exec injected for tests; serialized (K=1) per ToS. */
export class CodexAdapter implements WorkerAdapter {
  constructor(
    private exec: ExecFn,
    private opts: CodexOptions,
  ) {}

  async run(spec: WorkerSpec): Promise<WorkerOutcome> {
    const { stdout } = await this.exec('codex', buildCodexArgs(spec, this.opts), {
      cwd: spec.worktree,
    });
    return parseCodexStdout(stdout, spec).outcome;
  }
}
