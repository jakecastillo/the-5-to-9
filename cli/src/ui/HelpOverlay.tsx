import { Box, Text, useInput } from 'ink';
import { type Pane, bindingsFor } from './keymap.ts';

/**
 * The full keymap overlay for the focused pane. Rendered from the SAME single
 * keymap table that drives `useInput` and the footer (bindingsFor), so help can
 * never drift from real bindings. `Esc` closes.
 */
export function HelpOverlay({
  pane,
  onClose,
}: {
  pane: Pane;
  onClose: () => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  const bindings = bindingsFor(pane, true);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Keys — {pane} pane</Text>
      <Box marginTop={1} flexDirection="column">
        {bindings.map((b) => (
          <Text key={b.id}>
            <Text bold>{b.key.padEnd(10)}</Text>
            {b.help}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>esc close</Text>
      </Box>
    </Box>
  );
}
