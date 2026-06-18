import { Box, Text } from 'ink';
import type { DashboardModel } from '../operations/dashboard-model.ts';
import { iterationLabel } from './format.ts';

/**
 * The clock-out report, shown in place of the dashboard after `o`/`q`. A pure
 * function of the last-known model. Printed to normal scrollback once the
 * alt-screen is left (launch.ts restores it on exit). The viewer never aborts
 * the detached driver — this is a read-only summary.
 */
export function ShiftReportView({
  model,
}: {
  model: DashboardModel | null;
}): React.ReactElement {
  const s = model?.state;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>── Shift report ──</Text>
      {s == null || !s.active ? (
        <Text>No active shift.</Text>
      ) : (
        <Box flexDirection="column">
          <Text>goal {s.goal}</Text>
          <Text>branch {s.branch}</Text>
          <Text>iterations {iterationLabel(s.iteration, s.maxIterations)}</Text>
          {model && (
            <Text>
              shipped {model.progress.closed} · ready {model.readyCount} · blocked{' '}
              {model.counts.blocked ?? '?'}
            </Text>
          )}
          {model?.gate && (
            <Text>
              final gate {model.gate.color} ({model.gate.count} groups)
            </Text>
          )}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>The run continues in the background. q to exit.</Text>
      </Box>
    </Box>
  );
}
