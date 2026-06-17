// Minimal config surface so the CLI dispatch (A8) compiles. The real read/write
// + validation + env-override semantics are driven by A9's tests.
export interface CliConfig {
  backend?: 'claude' | 'codex' | 'api';
  maxIterations?: number | 'uncapped';
}

export function configPath(): string {
  return '';
}

export function readConfig(): CliConfig {
  return {};
}

export function setConfig(_key: string, _value: string): CliConfig {
  throw new Error('config set: not yet implemented');
}
