import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The persisted CLI config. Env vars still override at the operation read site. */
export interface CliConfig {
  backend?: 'claude' | 'codex' | 'api';
  maxIterations?: number | 'uncapped';
}

export const BACKENDS = ['claude', 'codex', 'api'] as const;

/** `$XDG_CONFIG_HOME/the-5-to-9/config.json`, falling back to `~/.config/...`. */
export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'the-5-to-9', 'config.json');
}

/**
 * The backend to use at an operation read site: the env override
 * (FIVE_TO_NINE_BACKEND) wins over the stored config, which wins over nothing.
 */
export function effectiveBackend(): CliConfig['backend'] | undefined {
  const env = process.env.FIVE_TO_NINE_BACKEND;
  if (env && (BACKENDS as readonly string[]).includes(env)) {
    return env as CliConfig['backend'];
  }
  return readConfig().backend;
}

/** Read the config file. Returns {} when absent or unparseable. */
export function readConfig(): CliConfig {
  try {
    const raw = readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CliConfig) : {};
  } catch {
    return {};
  }
}

/** Validate + coerce a (key, value) into the config, persist, and return it. */
export function setConfig(key: string, value: string): CliConfig {
  const cfg = readConfig();
  switch (key) {
    case 'backend': {
      if (!(BACKENDS as readonly string[]).includes(value)) {
        throw new Error(`invalid backend '${value}': valid backends are ${BACKENDS.join(', ')}`);
      }
      cfg.backend = value as CliConfig['backend'];
      break;
    }
    case 'maxIterations': {
      if (value === 'uncapped') {
        cfg.maxIterations = 'uncapped';
      } else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(
            `invalid maxIterations '${value}': expected a non-negative integer or "uncapped"`,
          );
        }
        cfg.maxIterations = n;
      }
      break;
    }
    default:
      throw new Error(`unknown config key '${key}': valid keys are backend, maxIterations`);
  }
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
  return cfg;
}
