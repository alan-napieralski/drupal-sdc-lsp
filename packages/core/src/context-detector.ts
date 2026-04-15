import type { InvocationContext } from './types.js';

const LOOKBACK_LIMIT = 2000;

/**
 * Pattern that matches an include/embed followed by a component ID string and an
 * opening `with {`. The text after `{` is captured to extract already-used keys.
 *
 * Anchored to end-of-string (`$`) so the cursor must be inside the `with {}` block.
 */
const INVOCATION_PATTERN =
  /(?:include|embed)\s+['"]([^'"]+)['"]\s+with\s+\{([^}]*)$/;

/**
 * Matches key names already used in the `with {}` object literal.
 */
const USED_KEY_PATTERN = /(\w+)\s*:/g;

/**
 * Detects whether the cursor is positioned inside a Twig `include/embed ... with { }` block.
 *
 * Returns an `InvocationContext` describing the component being called and the
 * prop keys already written, or `null` if the cursor is not in that position.
 *
 * Never throws on any input. Completes in under 1ms for typical inputs.
 *
 * @param documentText - Full text of the Twig document
 * @param cursorOffset - Zero-based character offset of the cursor in `documentText`
 * @returns Context with componentId and already-used keys, or `null`
 */
export function detectInvocationContext(
  documentText: string,
  cursorOffset: number,
): InvocationContext | null {
  if (documentText.length === 0 || cursorOffset <= 0) {
    return null;
  }

  const safeOffset = Math.min(cursorOffset, documentText.length);
  const lookbackStart = Math.max(0, safeOffset - LOOKBACK_LIMIT);
  const textBeforeCursor = documentText.slice(lookbackStart, safeOffset);

  // Apply the pattern against the full lookback window so that multi-line
  // `with {}` blocks are detected even when the cursor is on a different line
  // than the include/embed statement.
  const match = INVOCATION_PATTERN.exec(textBeforeCursor);
  if (match === null) {
    return null;
  }

  const componentId = match[1];
  const contentAfterBrace = match[2];

  const alreadyUsedKeys: string[] = [];
  let keyMatch: RegExpExecArray | null;

  USED_KEY_PATTERN.lastIndex = 0;
  while ((keyMatch = USED_KEY_PATTERN.exec(contentAfterBrace)) !== null) {
    alreadyUsedKeys.push(keyMatch[1]);
  }

  return { componentId, alreadyUsedKeys };
}
