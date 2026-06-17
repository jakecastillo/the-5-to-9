import { Box, Text } from 'ink';
import type { GateMarker, ShiftState } from '../state.ts';
import { iterationLabel, noColor, relativeTime } from './format.ts';

// The gate glyph — a filled circle, always paired with the colour WORD so
// meaning survives NO_COLOR / colour-blindness (the word, not the glyph shape,
// distinguishes GREEN from RED).
const GATE_GLYPH = '●';

/**
 * The always-on top chrome. A pure function of props: goal, branch,
 * `iter N / ∞`, a run indicator, and a color+word+glyph gate token. Colour is
 * gated on NO_COLOR; the word + glyph always render so meaning never depends on
 * colour alone.
 */
export function StatusBar({
  shift,
  gate,
  running,
}: {
  shift: ShiftState;
  gate: GateMarker | null;
  running: boolean;
}): React.ReactElement {
  const plain = noColor();

  if (!shift.active) {
    return (
      <Box flexDirection="column">
        <Text>The 5 to 9 — no active shift</Text>
      </Box>
    );
  }

  const gateColor = gate == null ? undefined : gate.color === 'GREEN' ? 'green' : 'red';
  const gateToken =
    gate == null
      ? 'gate  n/a'
      : `${GATE_GLYPH} ${gate.color} ${gate.count} groups · ${relativeTime(gate.ts)}`;

  return (
    <Box flexDirection="column">
      <Box>
        <Text>goal </Text>
        <Text bold>{shift.goal || '(none)'}</Text>
        <Text> branch </Text>
        <Text>{shift.branch || '(none)'}</Text>
      </Box>
      <Box>
        <Text>iter {iterationLabel(shift.iteration, shift.maxIterations)} </Text>
        <Text>{running ? '◴ running… ' : ''}</Text>
        <Text>gate </Text>
        <Text color={plain ? undefined : gateColor}>{gateToken}</Text>
      </Box>
    </Box>
  );
}
