import { Text } from 'ink';
import { type Pane, footerFor } from './keymap.ts';

/**
 * The contextual footer — "the manual". Renders ONLY the keys legal in the
 * focused pane + current shift state, generated from the single keymap table
 * (footerFor), so the displayed hints can never drift from real bindings.
 */
export function Footer({
  pane,
  shiftActive,
}: {
  pane: Pane;
  shiftActive: boolean;
}): React.ReactElement {
  // truncate-end: the footer is a single status line; it must never wrap to a
  // second row (which would push the layout). The full text is still the
  // single-source string from footerFor.
  return <Text wrap="truncate-end">{footerFor(pane, shiftActive)}</Text>;
}
