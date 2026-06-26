import { Box, Text } from 'ink';
import { COMMANDS, commandNames } from './commands.ts';
import { noColor } from './format.ts';
import { fuzzyRank } from './fuzzy.ts';

export interface CommandPaletteProps {
  /**
   * The full command-bar buffer including the leading '/'. Used to derive the
   * fuzzy query (verb part only — everything before the first space after '/').
   */
  query: string;
  /**
   * The currently highlighted row index (0-based). Clamped to the ranked list
   * length so callers never need to guard against out-of-range values.
   */
  selectedIndex: number;
}

/**
 * The slash-command palette, shown ABOVE the CommandBar whenever the buffer
 * starts with '/'. Fuzzy-ranks the registry (via `fuzzyRank`) and displays
 * name + summary + argHint for each match. One row is highlighted
 * (`selectedIndex`). Honors `noColor()` — the selected row uses inverse/bold
 * + the '▸' glyph so meaning never depends on colour alone.
 */
export function CommandPalette({ query, selectedIndex }: CommandPaletteProps): React.ReactElement {
  const plain = noColor();

  // Extract the verb portion (strip leading '/' then take everything before
  // the first whitespace so "/run --flag" still ranks against "run").
  const verbPart = query.slice(1).split(/\s+/)[0] ?? '';

  // Fuzzy-rank command names; empty query returns registry order.
  const ranked = fuzzyRank(verbPart, commandNames());

  if (ranked.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor> (no matching commands)</Text>
      </Box>
    );
  }

  const clampedIndex = Math.min(selectedIndex, ranked.length - 1);

  return (
    <Box flexDirection="column">
      {ranked.map((name, i) => {
        const cmd = COMMANDS.find((c) => c.name === name);
        if (!cmd) return null;
        const isSelected = i === clampedIndex;
        const glyph = isSelected ? '▸ ' : '  ';
        const argHintPart = cmd.argHint ? ` ${cmd.argHint}` : '';
        return (
          <Box key={name}>
            <Text inverse={isSelected && !plain} bold={isSelected}>
              {glyph}/{name}
              {argHintPart}
            </Text>
            <Text dimColor={!isSelected}>
              {' — '}
              {cmd.summary}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
