// The ONE shared classifier (hooks/irreversible-gate.mjs) so the driver, the CLI,
// and the plugin hook never drift. The .mjs ships without types of its own; since
// a relative import to an existing file resolves to that file (and so ignores any
// ambient `declare module`), we suppress the no-types diagnostic and re-type the
// imported function explicitly here.
// @ts-expect-error — irreversible-gate.mjs is a zero-dep JS module without a .d.ts
import * as gateMod from '../../hooks/irreversible-gate.mjs';

type FirstDenySegment = (cmd: string) => string | null;
const firstDenySegment = (gateMod as { firstDenySegment: FirstDenySegment }).firstDenySegment;

/** The verdict of classifying a shell command against the irreversible gate. */
export interface GateVerdict {
  /** True when the command (or any of its segments/substitutions) is irreversible. */
  denied: boolean;
  /** The first flagged segment, or null when nothing is denied. */
  segment: string | null;
}

/**
 * Classify a shell command using the shared irreversible-action classifier.
 */
export function classifyCommand(cmd: string): GateVerdict {
  const seg = firstDenySegment(cmd);
  return { denied: seg != null, segment: seg ?? null };
}
