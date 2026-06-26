import { Box, Text } from 'ink';
import { noColor } from './format.ts';

export interface CommandBarProps {
  /** The current command-bar buffer (empty string when idle). */
  value: string;
}

/**
 * The always-visible command bar at the bottom of the TUI.
 * Renders `> ` prompt + the live input buffer.
 * When empty, a dim placeholder describes what to type.
 * No autocomplete dropdown — that is bead 200.3.
 */
export function CommandBar({ value }: CommandBarProps): React.ReactElement {
  const plain = noColor();
  return (
    <Box>
      <Text color={plain ? undefined : 'cyan'}>{'> '}</Text>
      {value === '' ? (
        <Text dimColor>type /command or bare text to filter backlog</Text>
      ) : (
        <Text>{value}</Text>
      )}
    </Box>
  );
}
