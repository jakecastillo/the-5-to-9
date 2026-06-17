import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import { ClockInModal } from './ClockInModal.tsx';
import { GateNotice } from './GateNotice.tsx';
import { HelpOverlay } from './HelpOverlay.tsx';
import { footerFor } from './keymap.ts';

const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function wide(node: React.ReactElement) {
  return render(<Box width={120}>{node}</Box>);
}

test('ClockInModal: typing + Enter submits the goal', async () => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const { stdin, unmount } = wide(<ClockInModal onSubmit={onSubmit} onCancel={onCancel} />);
  await delay();
  stdin.write('ship X');
  await delay();
  stdin.write('\r'); // Enter
  await delay();
  expect(onSubmit).toHaveBeenCalledWith('ship X');
  expect(onCancel).not.toHaveBeenCalled();
  unmount();
});

test('ClockInModal: Esc cancels (no submit)', async () => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const { stdin, unmount } = wide(<ClockInModal onSubmit={onSubmit} onCancel={onCancel} />);
  await delay();
  stdin.write('\x1B'); // Esc
  await delay();
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  unmount();
});

test('GateNotice: renders the flagged segment + category + bead, no approve affordance', () => {
  const { lastFrame, unmount } = wide(
    <GateNotice
      segment="gh release create v1"
      category="publish"
      bead="t59-7e0"
      roleName="Cage Cashier"
      onDismiss={() => {}}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('gh release create v1');
  expect(f).toMatch(/publish/i);
  expect(f).toContain('t59-7e0');
  expect(f).toMatch(/resolve.*manually|manually/i);
  // Phase 1 is surface-only: there must be NO approve/confirm affordance.
  expect(f).not.toMatch(/approve/i);
  expect(f).not.toMatch(/type to confirm|y\/n|\[y\]/i);
  unmount();
});

test('GateNotice: traps input — a nav key does nothing; Esc dismisses with no side effect', async () => {
  const onDismiss = vi.fn();
  const { stdin, unmount } = wide(
    <GateNotice segment="git push --force" category="force-push" onDismiss={onDismiss} />,
  );
  await delay();
  stdin.write('j'); // nav key — inert under the trap
  await delay();
  expect(onDismiss).not.toHaveBeenCalled();
  stdin.write('\x1B'); // Esc
  await delay();
  expect(onDismiss).toHaveBeenCalledTimes(1);
  unmount();
});

test('HelpOverlay: lists the pane-consistent bindings; Esc closes', async () => {
  const onClose = vi.fn();
  const { lastFrame, stdin, unmount } = wide(<HelpOverlay pane="backlog" onClose={onClose} />);
  const f = lastFrame() ?? '';
  // It lists the same bindings the footer would show for the pane.
  for (const token of footerFor('backlog', true).split(' · ')) {
    const key = token.split(' ')[0];
    expect(f).toContain(key);
  }
  await delay();
  stdin.write('\x1B');
  await delay();
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
});
