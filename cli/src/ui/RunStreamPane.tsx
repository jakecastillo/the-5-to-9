import { Spinner } from '@inkjs/ui';
import { Box, Static, Text } from 'ink';

export interface RunStreamPaneProps {
  /** Completed journal lines from the ring buffer (already capped). */
  lines: string[];
  /** The in-progress tail line (live; not in <Static>). */
  liveLine: string;
  /** Whether follow/auto-scroll is on. */
  follow: boolean;
  /** Whether this pane is focused (for future visual highlight). */
  isActive: boolean;
  /** Whether a run is in progress (shows the spinner). */
  running: boolean;
}

/**
 * The Run Stream pane. Purely presentational — all keyboard handling is in
 * App's single useInput router (bead 200.2). Completed lines go through Ink's
 * `<Static>` — rendered ONCE and never repainted (fed from the bounded ring
 * buffer, so memory is capped). Only the in-progress tail line + spinner live
 * in re-rendering state.
 */
export function RunStreamPane({
  lines,
  liveLine,
  follow,
  running,
}: RunStreamPaneProps): React.ReactElement {
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
