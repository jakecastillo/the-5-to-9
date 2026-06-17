import { TextInput } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';

/**
 * The clock-in modal: a focus-trapping goal text input. `Enter` submits the
 * goal (TextInput.onSubmit); `Esc` cancels with no side effect. The parent
 * sets every other pane `isActive=false` so this traps input.
 */
export function ClockInModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (goal: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  // Esc cancels. (TextInput owns Enter via onSubmit.)
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Clock in — shift goal</Text>
      <Box marginTop={1}>
        <Text>{'> '}</Text>
        <TextInput placeholder="What should the crew ship?" onSubmit={onSubmit} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter submit · esc cancel</Text>
      </Box>
    </Box>
  );
}
