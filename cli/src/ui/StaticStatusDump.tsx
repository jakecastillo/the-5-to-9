import { Box, Text } from 'ink';
import type { DashboardModel, PendingGate } from '../operations/dashboard-model.ts';

/**
 * The scriptable instruction shown off-TTY when an irreversible action is
 * pending. The non-TTY path NEVER shows a modal and NEVER silent-allows —
 * instead it tells the operator exactly how to approve from a shell/CI, so
 * consent stays automatable.
 */
function PendingGateNotice({ pg }: { pg: PendingGate }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>irreversible action pending — resolve it from a shell:</Text>
      <Text>
        category: {pg.category} · command: {pg.command ?? pg.segment}
      </Text>
      <Text>to resolve: run the-5-to-9 in a TTY — the gate modal appears automatically</Text>
      <Text>
        pending id: {pg.id} · token: {pg.token}
      </Text>
    </Box>
  );
}

/**
 * The non-TTY / pipe / CI fallback: a plain, single-render status dump. No
 * interactive layout, no modal, no escape-heavy chrome. Honors NO_COLOR (Ink
 * already suppresses color when stdout is not a TTY; we also avoid any color
 * props here so the output is plain text either way).
 */
export function StaticStatusDump({ model }: { model: DashboardModel | null }): React.ReactElement {
  const pg = model?.pendingGate;
  if (model == null || !model.state.active) {
    return (
      <Box flexDirection="column">
        <Text>The 5 to 9 — no active shift</Text>
        <Text>
          run the-5-to-9 in a terminal, then type /clock-in &lt;goal&gt; in the command bar
        </Text>
        {pg?.id != null && <PendingGateNotice pg={pg} />}
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
        backlog: ready {model.readyCount} · in_progress {model.counts.inProgress ?? '?'} · blocked{' '}
        {model.counts.blocked ?? '?'} · closed {model.counts.closed ?? '?'}
      </Text>
      <Text>
        progress: {model.progress.closed}/{model.progress.total} ({model.progress.pct}%)
      </Text>
      {pg?.id != null && <PendingGateNotice pg={pg} />}
    </Box>
  );
}
