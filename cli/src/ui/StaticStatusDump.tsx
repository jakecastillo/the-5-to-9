import { Box, Text } from 'ink';
import type { DashboardModel } from '../operations/dashboard-model.ts';

/**
 * The non-TTY / pipe / CI fallback: a plain, single-render status dump. No
 * interactive layout, no modal, no escape-heavy chrome. Honors NO_COLOR (Ink
 * already suppresses color when stdout is not a TTY; we also avoid any color
 * props here so the output is plain text either way).
 */
export function StaticStatusDump({ model }: { model: DashboardModel | null }): React.ReactElement {
  if (model == null || !model.state.active) {
    return (
      <Box flexDirection="column">
        <Text>The 5 to 9 — no active shift</Text>
        <Text>run `the-5-to-9 clock-in &lt;goal&gt;` to start one</Text>
      </Box>
    );
  }
  const s = model.state;
  const cap = s.maxIterations === 'uncapped' || s.maxIterations === '' ? 'inf' : s.maxIterations;
  const g = model.gate;
  return (
    <Box flexDirection="column">
      <Text>The 5 to 9 — shift active</Text>
      <Text>goal: {s.goal || '(none)'}</Text>
      <Text>branch: {s.branch || '(none)'}</Text>
      <Text>
        iter: {s.iteration} / {cap}
      </Text>
      <Text>gate: {g ? `${g.color} ${g.count} groups (${g.ts})` : 'n/a'}</Text>
      <Text>
        backlog: ready {model.readyCount} · in_progress {model.counts.inProgress} · blocked{' '}
        {model.counts.blocked} · closed {model.counts.closed}
      </Text>
      <Text>
        progress: {model.progress.closed}/{model.progress.total} ({model.progress.pct}%)
      </Text>
    </Box>
  );
}
