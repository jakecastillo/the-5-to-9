import { Box, Text } from 'ink';
import { StaticStatusDump } from './StaticStatusDump.tsx';
import { type AppState, initialState } from './types.ts';

export interface AppProps {
  /** Seed UI/data state (tests pass a fixture model). */
  initial?: Partial<AppState>;
  /**
   * Whether the terminal supports raw mode. When false (pipe/CI), the App
   * degrades to a plain StaticStatusDump and never enters the interactive
   * layout. Defaults to true; `launch.ts` probes the real value.
   */
  rawModeSupported?: boolean;
}

/**
 * The root TUI component. Owns the single top-level state object. In Milestone B
 * this grows into the full 3-pane layout (B9); for now it renders a minimal
 * status header and degrades to StaticStatusDump off-TTY.
 */
export function App({ initial, rawModeSupported = true }: AppProps): React.ReactElement {
  const state: AppState = { ...initialState(), ...initial };

  if (!rawModeSupported) {
    return <StaticStatusDump model={state.model} />;
  }

  const goal = state.model?.state.goal || '(no active shift)';
  return (
    <Box flexDirection="column">
      <Text>The 5 to 9 — {goal}</Text>
    </Box>
  );
}
