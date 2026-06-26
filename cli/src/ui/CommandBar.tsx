import { Box, Text } from 'ink';
import { noColor } from './format.ts';

export interface CommandBarProps {
  /** The current command-bar buffer (empty string when idle). */
  value: string;
  /** Whether a shift is currently active (changes the empty-state placeholder). */
  shiftActive?: boolean;
  /**
   * The active backlog filter string (non-empty when bare-text live filter or
   * /filter command is active). Shown as a small indicator above the input line.
   */
  filter?: string;
  /** Number of beads that match the current filter (shown in the indicator). */
  matchCount?: number;
}

/**
 * The always-visible command bar at the bottom of the TUI. Renders a `> `
 * prompt + the live input buffer. When the buffer is empty, a dim placeholder
 * guides the user (idle vs active shift). When a filter is active, a small
 * indicator line above the prompt shows the query and match count.
 */
export function CommandBar({
  value,
  shiftActive,
  filter,
  matchCount,
}: CommandBarProps): React.ReactElement {
  const plain = noColor();

  const placeholder =
    shiftActive === false
      ? 'type /clock-in <goal> to start a shift  ·  / for commands'
      : 'type /command or bare text to filter backlog';

  const matchWord = matchCount === 1 ? 'match' : 'matches';

  return (
    <Box flexDirection="column">
      {filter && filter.length > 0 && (
        <Text dimColor>
          {'filter: '}
          {filter}
          {` (${matchCount ?? 0} ${matchWord})`}
        </Text>
      )}
      <Box>
        <Text color={plain ? undefined : 'cyan'}>{'> '}</Text>
        {value === '' ? <Text dimColor>{placeholder}</Text> : <Text>{value}</Text>}
      </Box>
    </Box>
  );
}
