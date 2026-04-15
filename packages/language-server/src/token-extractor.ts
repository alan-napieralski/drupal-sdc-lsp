/**
 * Pattern that matches a `provider:component` style ID token.
 * Allows letters, digits, underscores, and hyphens on both sides of the colon.
 */
const COMPONENT_ID_PATTERN = /[a-z0-9_][a-z0-9_-]*:[a-z0-9_][a-z0-9_-]*/g;

/**
 * Describes a matched component ID token and its position within a line.
 */
export interface ComponentIdToken {
  id: string;
  start: number;
  end: number;
}

/**
 * Extracts the `provider:component` token from a line of text at a given
 * character offset, along with its start/end positions within the line.
 *
 * @param lineText - Full text of the line
 * @param characterOffset - Zero-based cursor position within the line
 * @returns The matched token with position info, or `null` if no token spans the cursor
 */
export function extractComponentIdTokenAtOffset(
  lineText: string,
  characterOffset: number,
): ComponentIdToken | null {
  COMPONENT_ID_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = COMPONENT_ID_PATTERN.exec(lineText)) !== null) {
    const tokenStart = match.index;
    const tokenEnd = tokenStart + match[0].length;

    if (characterOffset >= tokenStart && characterOffset <= tokenEnd) {
      return { id: match[0], start: tokenStart, end: tokenEnd };
    }
  }

  return null;
}
