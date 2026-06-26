import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test } from 'vitest';
import { Footer } from './Footer.tsx';
import { KEYMAP, footerFor } from './keymap.ts';

test('new KEYMAP: footerFor contains all command-model bindings', () => {
  const text = footerFor('status', true);
  // All entries in the new KEYMAP must appear in the footer
  for (const b of KEYMAP) {
    expect(text).toContain(b.key);
    expect(text).toContain(b.action);
  }
  // Uses the `key action` join with a middot separator
  expect(text).toContain('·');
  // Dead single-letter bindings from the old keymap are gone
  expect(text).not.toContain('j/k');
  expect(text).not.toContain('g/G');
});

test('footer content is identical for all panes (all bindings are global)', () => {
  const status = footerFor('status', true);
  const backlog = footerFor('backlog', true);
  const stream = footerFor('stream', true);
  expect(backlog).toBe(status);
  expect(stream).toBe(status);
});

test('footer content is identical regardless of shiftActive (no requiresShift bindings)', () => {
  const active = footerFor('backlog', true);
  const idle = footerFor('backlog', false);
  expect(active).toBe(idle);
});

test('Footer renders exactly footerFor (generated from the table — cannot drift)', () => {
  // Give it room so truncate-end (single-line footer) does not cut the string
  const { lastFrame, unmount } = render(
    <Box width={200}>
      <Footer pane="backlog" shiftActive />
    </Box>,
  );
  expect(lastFrame()?.trimEnd()).toBe(footerFor('backlog', true));
  unmount();
});
