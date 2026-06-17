import { TextInput } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { noColor } from './format.ts';

/** The pending consent the modal is confirming (the subset the UI needs). */
export interface GatePending {
  id: string;
  command: string;
  category: string;
  token: string;
  bead?: string;
  role?: string;
}

/**
 * The type-to-confirm gate modal (Phase 1b). It is fail-closed by construction:
 *
 *  - Default focus is DENY. A bare `Enter` (empty input) and `Esc` both DENY.
 *  - Approval requires typing the exact token; the decision is delegated to
 *    `resolve(id, true, token)` — the SOURCE OF TRUTH. If `resolve` refuses
 *    (wrong token / write-once), the modal STAYS OPEN with an error and never
 *    closes as if approved. There is no path that silent-allows.
 *
 * The parent sets every other pane inactive so this traps input.
 */
export function GateModal({
  pending,
  resolve,
  onClose,
}: {
  pending: GatePending;
  /** The consent resolver (consent.resolve). Injected so tests can spy. */
  resolve: (id: string, approved: boolean, token?: string) => { ok: boolean; error?: string };
  /** Close the modal (only after a DENY or a successful APPROVE). */
  onClose: () => void;
}): React.ReactElement {
  const plain = noColor();
  const [error, setError] = useState<string | null>(null);

  const deny = () => {
    resolve(pending.id, false, undefined);
    onClose();
  };

  // Esc denies (TextInput owns Enter via onSubmit). Every other key falls
  // through to the TextInput; nav can never scroll the modal away.
  useInput((_input, key) => {
    if (key.escape) deny();
  });

  // Enter routes here with the current input value. Fail-closed at every step:
  //  - empty            → DENY (Enter-on-default).
  //  - typed ≠ token    → error; do NOT even attempt an approve (no resolve true).
  //  - typed === token  → attempt approve; resolve() is the final gate. If it
  //                       refuses (write-once race, etc.) stay open with an error.
  const onSubmit = (typed: string) => {
    if (typed.length === 0) {
      deny();
      return;
    }
    if (typed !== pending.token) {
      setError('wrong token — approval refused. Type it exactly, or Esc to deny.');
      return;
    }
    const res = resolve(pending.id, true, typed);
    if (res.ok) {
      onClose();
      return;
    }
    // Fail-closed: do NOT close as approved; show why and stay open.
    setError(res.error ?? 'approval refused. Press Esc to deny.');
  };

  const who = [
    pending.bead ? `bead ${pending.bead}` : '',
    pending.role ? `role ${pending.role}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      paddingX={1}
      borderColor={plain ? undefined : 'red'}
    >
      <Text bold color={plain ? undefined : 'red'}>
        IRREVERSIBLE ACTION — APPROVE OR DENY
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>category: {pending.category}</Text>
        <Text>command: {pending.command}</Text>
        {/[;&|`]|\$\(/.test(pending.command) && (
          <Text bold color={plain ? undefined : 'yellow'}>
            {
              '⚠ shell operators present — this command CHAINS operations. Read the WHOLE command before approving; the token confirms this exact string.'
            }
          </Text>
        )}
        {who !== '' && <Text>{who}</Text>}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          To APPROVE, type exactly: <Text bold>{pending.token}</Text>
        </Text>
        <Box>
          <Text>{'> '}</Text>
          <TextInput placeholder="(empty + Enter = deny)" onSubmit={onSubmit} />
        </Box>
      </Box>
      {error != null && (
        <Box marginTop={1}>
          <Text color={plain ? undefined : 'red'}>{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>enter approve (if exact) · empty enter / esc deny</Text>
      </Box>
    </Box>
  );
}
