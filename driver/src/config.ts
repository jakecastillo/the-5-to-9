export type Backend = 'claude' | 'codex' | 'api';
export type CredentialMode = 'subscription' | 'metered-api';

export interface RawArgs {
  backend?: Backend;
  goal: string;
  maxIterations?: number;
  noProgressWindow?: number;
  concurrency?: number;
  budgetUsd?: number;
  budgetTokens?: number;
}

export interface RunConfig {
  backend: Backend;
  credentialMode: CredentialMode;
  goal: string;
  maxIterations: number;
  noProgressWindow: number;
  concurrency: number;
  budgetUsd: number;
  budgetTokens: number;
  banner: string;
}

const SUBSCRIPTION: Record<Backend, boolean> = { claude: true, codex: true, api: false };

/** Remove a stray ANTHROPIC_API_KEY unless the api backend was explicitly chosen (spec §2.1 safety). */
export function scrubbedEnv(backend: Backend, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (backend === 'api') return { ...env };
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k !== 'ANTHROPIC_API_KEY') out[k] = v;
  }
  return out;
}

export function resolveConfig(a: RawArgs): RunConfig {
  if (!a.backend) throw new Error('credential mode unconfirmed: pass --backend claude|codex|api');
  const credentialMode: CredentialMode = SUBSCRIPTION[a.backend] ? 'subscription' : 'metered-api';
  // subscription-first SERIALIZED: K>1 only allowed on the api backend (spec §2.1)
  const concurrency = a.backend === 'api' ? (a.concurrency ?? 2) : 1;
  const maxIterations = a.maxIterations ?? 30;
  const noProgressWindow = a.noProgressWindow ?? 3;
  const budgetUsd = a.budgetUsd ?? (credentialMode === 'metered-api' ? 5 : 0);
  const budgetTokens = a.budgetTokens ?? 0;
  if (maxIterations < 1) throw new Error('--max-iterations must be >= 1');
  const banner =
    `This shift bills ${a.backend} as ${credentialMode}; ` +
    `K=${concurrency}, cap=${maxIterations}, budget<=$${budgetUsd}/${budgetTokens || '∞'} tokens.`;
  return {
    backend: a.backend,
    credentialMode,
    goal: a.goal,
    maxIterations,
    noProgressWindow,
    concurrency,
    budgetUsd,
    budgetTokens,
    banner,
  };
}
