import { Spinner } from '@inkjs/ui';
import { Box, Text } from 'ink';

export interface RunStreamPaneProps {
  /** Completed journal lines from the ring buffer (already capped). */
  lines: string[];
  /** The in-progress tail line (live; not in the windowed area). */
  liveLine: string;
  /** Whether follow/auto-scroll is on. */
  follow: boolean;
  /** Whether this pane is focused (for future visual highlight). */
  isActive: boolean;
  /** Whether a run is in progress (shows the spinner). */
  running: boolean;
  /**
   * How many terminal rows are available for the scrollable line area.
   * Derived from App's `rows` and passed down so the pane knows the window
   * size without importing stdout directly.
   */
  viewportHeight: number;
  /**
   * Scroll offset: 0 = pinned to the tail; N = viewport ends N lines above
   * the tail. Set by App's arrow-key router (bead 200.9).
   */
  scroll: number;
}

/**
 * The Run Stream pane. Purely presentational — all keyboard handling is in
 * App's single useInput router (bead 200.2 / 200.9).
 *
 * --- Static → windowed trade-off (bead 200.9) ---
 * The original implementation used Ink's `<Static>` which prints completed
 * lines ONCE to the terminal scrollback and never repaints them. That is
 * correct for pure tailing but makes in-app scrolling impossible (Static
 * output lives in the terminal's own scrollback, not in the alt-screen
 * managed area). Replacing it with a plain windowed slice means completed
 * lines ARE repainted on every render tick — but the window is bounded by
 * `viewportHeight`, so repaint cost is O(viewportHeight), not O(total lines).
 * Memory stays O(ring-buffer-cap) because we only SELECT a slice, never grow
 * the buffer. Under alt-screen there is no terminal scrollback anyway, so the
 * windowed approach is also more correct in that environment.
 */
export function RunStreamPane({
  lines,
  liveLine,
  follow,
  running,
  viewportHeight,
  scroll,
}: RunStreamPaneProps): React.ReactElement {
  // Compute the visible window.
  // scroll=0 → last viewportHeight lines (tail).
  // scroll=k → window ending k lines above the tail.
  const windowEnd = lines.length - scroll;
  const windowStart = Math.max(0, windowEnd - viewportHeight);
  const visible = lines.slice(windowStart, windowEnd);

  // Compact scroll indicators (NO_COLOR-safe — words, not colour only).
  const aboveCount = Math.max(0, lines.length - viewportHeight - scroll);
  const belowCount = scroll; // lines below the visible window (scrolled past)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        <Text dimColor>RUN STREAM · follow {follow ? '▸ on' : '· off'}</Text>
      </Box>
      {aboveCount > 0 && (
        <Box>
          <Text dimColor>↑ {aboveCount} older</Text>
        </Box>
      )}
      {visible.map((line, i) => (
        <Text key={`${windowStart + i}`}>{line}</Text>
      ))}
      {belowCount > 0 && (
        <Box>
          <Text dimColor>↓ {belowCount} newer</Text>
        </Box>
      )}
      {(liveLine !== '' || running) && (
        <Box>
          {running ? <Spinner /> : <Text>◴</Text>}
          <Text> {liveLine}</Text>
        </Box>
      )}
    </Box>
  );
}
