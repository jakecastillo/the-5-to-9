import { render } from 'ink-testing-library';
import { expect, test } from 'vitest';
import { App } from './App.tsx';
import { ACTIVE_MODEL, IDLE_MODEL } from './fixtures.ts';

test('App renders the goal text from the initial model', () => {
  const { lastFrame, unmount } = render(<App initial={{ model: ACTIVE_MODEL }} />);
  expect(lastFrame()).toContain('Ship auth refactor + green CI');
  unmount();
});

test('App in non-raw stdin falls back to StaticStatusDump (no interactive layout)', () => {
  const { lastFrame, unmount } = render(
    <App initial={{ model: IDLE_MODEL }} rawModeSupported={false} />,
  );
  const frame = lastFrame() ?? '';
  // The plain dump names the inactive shift and never paints the pane chrome.
  expect(frame).toMatch(/no active shift/i);
  // It must NOT render the interactive pane layout.
  expect(frame).not.toMatch(/RUN STREAM/);
  expect(frame).not.toMatch(/BACKLOG/);
  unmount();
});
