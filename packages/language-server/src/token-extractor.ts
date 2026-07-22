// Matches a `provider:component` style ID token.
const COMPONENT_ID_PATTERN = /[a-z0-9_][a-z0-9_-]*:[a-z0-9_][a-z0-9_-]*/g;

// Matches a `@provider/relative/path.twig` namespace path token.
const NAMESPACE_PATH_PATTERN = /@[a-z0-9_-]+\/[a-z0-9_\-./]+/gi;

/** A matched reference token and its position within a line. */
export interface ComponentIdToken {
  /** The matched token text. */
  id: string;
  /** Zero-based start offset within the line. */
  start: number;
  /** Zero-based end offset within the line. */
  end: number;
}

/**
 * Extracts the `provider:component` token spanning the cursor.
 *
 * @param lineText - Full text of the line
 * @param characterOffset - Zero-based cursor position within the line
 * @returns The matched token with position info, or null if none spans the cursor
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

/**
 * Extracts the `@provider/path.twig` namespace path token spanning the cursor.
 *
 * @param lineText - Full text of the line
 * @param characterOffset - Zero-based cursor position within the line
 * @returns The matched token with position info, or null if none spans the cursor
 */
export function extractNamespacePathTokenAtOffset(
  lineText: string,
  characterOffset: number,
): ComponentIdToken | null {
  NAMESPACE_PATH_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = NAMESPACE_PATH_PATTERN.exec(lineText)) !== null) {
    const tokenStart = match.index;
    const tokenEnd = tokenStart + match[0].length;

    if (characterOffset >= tokenStart && characterOffset <= tokenEnd) {
      return { id: match[0], start: tokenStart, end: tokenEnd };
    }
  }

  return null;
}
