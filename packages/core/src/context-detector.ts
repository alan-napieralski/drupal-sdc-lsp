import type { InvocationContext } from './types.js';

const LOOKBACK_LIMIT = 2000;

// Matches `include`/`embed` + component id + open `with {`, capturing text after the brace; anchored to end so the cursor sits inside the block.
const INVOCATION_PATTERN =
  /(?:include|embed)\s+['"]([^'"]+)['"]\s+with\s+\{([^}]*)$/;

// Matches key names already used in the `with {}` object literal.
const USED_KEY_PATTERN = /(\w+)\s*:/g;

/**
 * Detects whether the cursor is inside a Twig `include/embed ... with { }` block.
 *
 * @param documentText - Full text of the Twig document
 * @param cursorOffset - Zero-based character offset of the cursor in the document
 * @returns Context with the component ID and already-used keys, or null if not in that position
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
