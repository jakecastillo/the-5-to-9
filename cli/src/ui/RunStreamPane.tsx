import { Spinner } from '@inkjs/ui';
import { Box, Static, Text, useInput } from 'ink';

export interface RunStreamPaneProps {
  /** Completed journal lines from the ring buffer (already capped). */
  lines: string[];
  /** The in-progress tail line (live; not in <Static>). */
  liveLine: string;
  /** Whether follow/auto-scroll is on. */
  follow: boolean;
  /** Whether this pane is focused (only then does `f` toggle follow). */
  isActive: boolean;
  /** Whether a run is in progress (shows the spinner). */
  running: boolean;
  /** Called when `f` is pressed to toggle follow. */
  onToggleFollow?: () => void;
}

/**
 * The Run Stream pane. Completed lines go through Ink's `<Static>` — rendered
 * ONCE and never repainted (and fed from the bounded ring buffer, so memory is
 * capped). Only the in-progress tail line + spinner live in re-rendering state.
 * `f` toggles follow.
 */
export function RunStreamPane({
  lines,
  liveLine,
  follow,
  isActive,
  running,
  onToggleFollow,
}: RunStreamPaneProps): React.ReactElement {
  useInput(
    (input) => {
      if (input === 'f') onToggleFollow?.();
    },
    { isActive },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        <Text dimColor>RUN STREAM · follow {follow ? '▸ on' : '· off'}</Text>
      </Box>
      <Static items={lines}>{(line, i) => <Text key={`${i}-${line}`}>{line}</Text>}</Static>
      {(liveLine !== '' || running) && (
        <Box>
          {running ? <Spinner /> : <Text>◴</Text>}
          <Text> {liveLine}</Text>
        </Box>
      )}
    </Box>
  );
}
