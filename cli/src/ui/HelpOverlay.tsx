import { Box, Text, useInput } from 'ink';
import { COMMANDS } from './commands.ts';
import { type Pane, bindingsFor } from './keymap.ts';

/**
 * The full keymap + slash-command vocabulary overlay. Rendered from the SAME
 * single keymap table that drives `useInput` and the footer (`bindingsFor`), so
 * help can never drift from real bindings. Also lists every slash command with
 * its summary so `?`/`/help` shows the full vocabulary. `Esc` closes.
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
      <Text bold>Keys</Text>
      <Box marginTop={1} flexDirection="column">
        {bindings.map((b) => (
          <Text key={b.id}>
            <Text bold>{b.key.padEnd(12)}</Text>
            {b.help}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Commands</Text>
        {COMMANDS.map((cmd) => {
          const hint = cmd.argHint ? ` ${cmd.argHint}` : '';
          const pad = Math.max(0, 30 - cmd.name.length - hint.length);
          return (
            <Text key={cmd.name}>
              <Text bold>
                {'  /'}
                {cmd.name}
                {hint.padEnd(pad)}
              </Text>
              {'  '}
              {cmd.summary}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>esc close</Text>
      </Box>
    </Box>
  );
}
