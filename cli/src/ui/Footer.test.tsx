import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test } from 'vitest';
import { Footer } from './Footer.tsx';
import { KEYMAP, footerFor } from './keymap.ts';

test('footerFor lists exactly the bindings for the pane + global, formatted', () => {
  const text = footerFor('backlog', true);
  // Every binding that applies to backlog (or is global) appears.
  const expected = KEYMAP.filter(
    (b) =>
      (b.panes === 'global' || b.panes.includes('backlog')) &&
      (!b.requiresShift || true) /* shiftActive=true */,
  );
  for (const b of expected) {
    expect(text).toContain(b.key);
    expect(text).toContain(b.action);
  }
  // Bindings that don't apply to backlog are absent (e.g. the stream-only `f`).
  const streamOnly = KEYMAP.find((b) => b.key === 'f');
  expect(streamOnly).toBeDefined();
  expect(text).not.toContain('follow');
  // Uses the `key action` join with a middot separator.
  expect(text).toContain('·');
});

test('shift-gated actions (r/o) appear only when shiftActive', () => {
  const active = footerFor('backlog', true);
  const idle = footerFor('backlog', false);
  expect(active).toContain('run');
  expect(active).toContain('clock-out');
  expect(idle).not.toContain('run');
  expect(idle).not.toContain('clock-out');
});

test('Footer renders exactly footerFor (generated from the table — cannot drift)', () => {
  // Give it room so truncate-end (single-line footer) doesn't cut the string.
  const { lastFrame, unmount } = render(
    <Box width={200}>
      <Footer pane="backlog" shiftActive />
    </Box>,
  );
  expect(lastFrame()?.trimEnd()).toBe(footerFor('backlog', true));
  unmount();
});
