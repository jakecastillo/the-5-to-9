import { Box, Text, useInput } from 'ink';
import type { BeadLite } from '../beads-read.ts';
import type { DashboardModel } from '../operations/dashboard-model.ts';
import { noColor, truncate } from './format.ts';

export interface BacklogPaneProps {
  model: DashboardModel;
  /** Whether this pane is focused (only then does it consume key input). */
  isActive: boolean;
  /** The selected bead id (held in App state, separate from polled data). */
  selectedId: string | null;
  /** The filter string (empty = no filter). Matches id/title/state. */
  filter: string;
  /** Called with the newly-selected id on j/k/g/G. */
  onSelect: (id: string) => void;
}

interface Section {
  label: string;
  color?: string;
  beads: BeadLite[];
}

/** Does a bead match the (lowercased) filter on id/title/state? */
function matches(b: BeadLite, q: string): boolean {
  if (q === '') return true;
  const hay = `${b.id} ${b.title} ${b.status ?? ''}`.toLowerCase();
  return hay.includes(q);
}

/** A 20-cell progress bar like `[████████░░░░] closed 7/11 (63%)`. */
function progressBar(closed: number, total: number, pct: number): string {
  const width = 20;
  const filled = total > 0 ? Math.round((closed / total) * width) : 0;
  const bar = '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
  return `[${bar}] closed ${closed}/${total} (${pct}%)`;
}

function BeadRow({
  bead,
  selected,
  plain,
}: {
  bead: BeadLite;
  selected: boolean;
  plain: boolean;
}): React.ReactElement {
  const marker = selected ? '▸ ' : '  ';
  const text = `${marker}${bead.id}  ${truncate(bead.title, 40)}`;
  return (
    <Text inverse={selected && !plain} bold={selected}>
      {text}
    </Text>
  );
}

/**
 * The Backlog pane: READY / IN-PROGRESS / BLOCKED sections + a progress bar.
 * Selection/filter come in as props (held in App state, separate from polled
 * data) so a background poll never yanks the cursor. j/k/g/G move the selection
 * through the flattened, filtered list and report via `onSelect`. The Ink flex
 * layout auto-flows the sections — no manual scroll offset needed.
 */
export function BacklogPane({
  model,
  isActive,
  selectedId,
  filter,
  onSelect,
}: BacklogPaneProps): React.ReactElement {
  const plain = noColor();
  const q = filter.trim().toLowerCase();

  const sections: Section[] = [
    { label: 'READY', beads: model.ready.filter((b) => matches(b, q)) },
    { label: 'IN-PROGRESS', beads: model.inProgress.filter((b) => matches(b, q)) },
    { label: 'BLOCKED', color: 'red', beads: model.blocked.filter((b) => matches(b, q)) },
  ];

  // The flattened, in-order list the cursor walks.
  const flat = sections.flatMap((s) => s.beads);
  const ids = flat.map((b) => b.id);

  useInput(
    (input, key) => {
      if (ids.length === 0) return;
      const cur = selectedId != null ? ids.indexOf(selectedId) : -1;
      if (key.downArrow || input === 'j') {
        const next = cur < 0 ? 0 : Math.min(cur + 1, ids.length - 1);
        onSelect(ids[next]);
      } else if (key.upArrow || input === 'k') {
        const next = cur < 0 ? 0 : Math.max(cur - 1, 0);
        onSelect(ids[next]);
      } else if (input === 'g') {
        onSelect(ids[0]);
      } else if (input === 'G') {
        onSelect(ids[ids.length - 1]);
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text>{progressBar(model.progress.closed, model.progress.total, model.progress.pct)}</Text>
      {sections.map((s) => (
        <Box key={s.label} flexDirection="column" marginTop={1}>
          <Text color={plain ? undefined : s.color} dimColor={!s.color}>
            ─ {s.label} ({s.beads.length}) ─
          </Text>
          {s.beads.length === 0 ? (
            <Text dimColor> (none)</Text>
          ) : (
            s.beads.map((b) => (
              <BeadRow key={b.id} bead={b} selected={b.id === selectedId} plain={plain} />
            ))
          )}
        </Box>
      ))}
    </Box>
  );
}
