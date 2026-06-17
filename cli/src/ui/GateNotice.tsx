import { Box, Text, useInput } from 'ink';
import { noColor } from './format.ts';

/**
 * The Phase-1 gate notice: a blocking, focus-trapping surface that names the
 * flagged command, its irreversible category, and the bead/role that triggered
 * it. It TRAPS input — only `Esc` dismisses, and dismissal has NO side effect
 * (it does not approve or resume; interactive approve is Phase 1b). Every other
 * key is swallowed so nav can't scroll the notice away.
 */
export function GateNotice({
  segment,
  category,
  bead,
  roleName,
  onDismiss,
}: {
  segment: string;
  category: string;
  bead?: string;
  roleName?: string;
  onDismiss: () => void;
}): React.ReactElement {
  const plain = noColor();
  // Trap: swallow everything; only Esc dismisses (no approve in Phase 1).
  useInput((_input, key) => {
    if (key.escape) onDismiss();
    // All other keys are intentionally inert.
  });

  const who = [bead ? `bead ${bead}` : '', roleName ? `role ${roleName}` : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      paddingX={1}
      borderColor={plain ? undefined : 'red'}
    >
      <Text bold color={plain ? undefined : 'red'}>
        ⛔ IRREVERSIBLE ACTION BLOCKED
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>category: {category}</Text>
        <Text>command: {segment}</Text>
        {who !== '' && <Text>{who}</Text>}
      </Box>
      <Box marginTop={1}>
        <Text>Resolve this manually, then re-run. (Approval lands in a later phase.)</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>esc dismiss</Text>
      </Box>
    </Box>
  );
}
