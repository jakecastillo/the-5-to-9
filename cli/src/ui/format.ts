/** True when colour should be suppressed (NO_COLOR set to any non-empty value). */
export function noColor(): boolean {
  return typeof process.env.NO_COLOR === 'string' && process.env.NO_COLOR !== '';
}

/**
 * A coarse "Nm ago" / "Ns ago" relative timestamp. Returns '' for an unparseable
 * input. Stable + allocation-light for use inside renders.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** The iteration display: `N / ∞` when uncapped, else `N / M`. */
export function iterationLabel(iteration: number, maxIterations: string): string {
  const cap = maxIterations === 'uncapped' || maxIterations === '' ? '∞' : maxIterations;
  return `${iteration} / ${cap}`;
}

/** Truncate a string for single-line display, appending an ellipsis. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return `${s.slice(0, max - 1)}…`;
}
