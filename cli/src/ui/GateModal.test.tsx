import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import { GateModal } from './GateModal.tsx';

const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));
function wide(node: React.ReactElement) {
  return render(<Box width={120}>{node}</Box>);
}

const PENDING = {
  id: 'c-123',
  command: 'gh release create v1',
  category: 'publish',
  token: 'gh',
  bead: 't59-7e0',
  role: 'Cage Cashier',
} as const;

test('GateModal renders the command, category, bead/role, and the required token', () => {
  const { lastFrame, unmount } = wide(
    <GateModal pending={PENDING} resolve={vi.fn()} onClose={vi.fn()} />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('gh release create v1');
  expect(f).toMatch(/publish/i);
  expect(f).toContain('t59-7e0');
  expect(f).toContain('gh'); // the token to type
  unmount();
});

test('a bare Enter on the default DENIES (resolve called with approved=false), then closes', async () => {
  const resolve = vi.fn(() => ({ ok: true }));
  const onClose = vi.fn();
  const { stdin, unmount } = wide(
    <GateModal pending={PENDING} resolve={resolve} onClose={onClose} />,
  );
  await delay();
  stdin.write('\r'); // Enter with no token typed → default deny
  await delay();
  expect(resolve).toHaveBeenCalledWith('c-123', false, undefined);
  // INVARIANT: must NEVER approve on a bare Enter.
  expect(resolve).not.toHaveBeenCalledWith('c-123', true, expect.anything());
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
});

test('Esc DENIES and closes (default-deny, no side effect beyond the deny)', async () => {
  const resolve = vi.fn(() => ({ ok: true }));
  const onClose = vi.fn();
  const { stdin, unmount } = wide(
    <GateModal pending={PENDING} resolve={resolve} onClose={onClose} />,
  );
  await delay();
  stdin.write('\x1B'); // Esc
  await delay();
  expect(resolve).toHaveBeenCalledWith('c-123', false, undefined);
  expect(resolve).not.toHaveBeenCalledWith('c-123', true, expect.anything());
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
});

test('the WRONG token + Enter does NOT approve and the modal stays open with an error', async () => {
  const resolve = vi.fn(() => ({ ok: false, error: 'token mismatch' }));
  const onClose = vi.fn();
  const { lastFrame, stdin, unmount } = wide(
    <GateModal pending={PENDING} resolve={resolve} onClose={onClose} />,
  );
  await delay();
  stdin.write('nope'); // wrong token
  await delay();
  stdin.write('\r'); // Enter
  await delay();
  // INVARIANT: a wrong token NEVER produces an approval.
  expect(resolve).not.toHaveBeenCalledWith('c-123', true, expect.anything());
  // The modal stays open (onClose NOT called) and shows an error.
  expect(onClose).not.toHaveBeenCalled();
  expect(lastFrame() ?? '').toMatch(/wrong|mismatch|incorrect|denied|try again/i);
  unmount();
});

test('the CORRECT token + Enter APPROVES (resolve true with the token) and closes', async () => {
  const resolve = vi.fn(() => ({ ok: true }));
  const onClose = vi.fn();
  const { stdin, unmount } = wide(
    <GateModal pending={PENDING} resolve={resolve} onClose={onClose} />,
  );
  await delay();
  stdin.write('gh'); // correct token
  await delay();
  stdin.write('\r'); // Enter
  await delay();
  expect(resolve).toHaveBeenCalledWith('c-123', true, 'gh');
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
});

test('a failed approve (resolve returns ok:false) keeps the modal open — never silent-allow', async () => {
  // Even if the token typed matches the displayed token, the SOURCE OF TRUTH is
  // consent.resolve(): if it refuses, the modal must not close as if approved.
  const resolve = vi.fn(() => ({ ok: false, error: 'token mismatch — approval refused' }));
  const onClose = vi.fn();
  const { lastFrame, stdin, unmount } = wide(
    <GateModal pending={PENDING} resolve={resolve} onClose={onClose} />,
  );
  await delay();
  stdin.write('gh');
  await delay();
  stdin.write('\r');
  await delay();
  expect(onClose).not.toHaveBeenCalled();
  expect(lastFrame() ?? '').toMatch(/refused|mismatch|wrong|try again/i);
  unmount();
});
