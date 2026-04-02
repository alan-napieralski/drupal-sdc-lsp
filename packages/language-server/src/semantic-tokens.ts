import type {
  SemanticTokens,
  SemanticTokensParams,
  TextDocuments,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/** Token type index 0 = keyword. Matches twiggy's classification. */
export const SEMANTIC_TOKEN_LEGEND = {
  tokenTypes: ['keyword'],
  tokenModifiers: [] as string[],
};

const KEYWORD_TYPE = 0;

// ---------------------------------------------------------------------------
// Known Twig keywords
// ---------------------------------------------------------------------------

/**
 * All Twig keywords that should receive `keyword` semantic type.
 * Mirrors what twiggy_language_server emits so colors are identical
 * whether twiggy is enabled or not.
 */
const TWIG_KEYWORDS = new Set([
  // Template inheritance
  'extends', 'block', 'endblock', 'use',
  // Inclusion
  'include', 'embed', 'endembed', 'from', 'import', 'as',
  // Control flow
  'if', 'elseif', 'else', 'endif',
  'for', 'in', 'endfor',
  // Variables
  'set', 'endset',
  // Macros
  'macro', 'endmacro',
  // Filters / apply
  'apply', 'endapply',
  'filter', 'endfilter',
  // Scope
  'with', 'endwith', 'only',
  // Output
  'verbatim', 'endverbatim',
  // i18n
  'trans', 'endtrans',
  // Caching
  'cache', 'endcache',
  // Operators that appear as words
  'not', 'and', 'or', 'is', 'matches',
]);

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Matches `{%` or `{%-` followed by optional whitespace and a word.
 * Group 1 captures the keyword itself.
 */
const TAG_KEYWORD_RE = /\{%-?\s*(\w+)/g;

/**
 * Returns LSP semantic tokens for all Twig keywords in the document.
 * Tokens are delta-encoded as required by the LSP spec.
 *
 * @param params   - LSP semantic tokens request params
 * @param documents - Open document store
 */
export function getSemanticTokens(
  params: SemanticTokensParams,
  documents: TextDocuments<TextDocument>,
): SemanticTokens {
  const doc = documents.get(params.textDocument.uri);
  if (doc === undefined) return { data: [] };

  const text = doc.getText();
  const data: number[] = [];

  let prevLine = 0;
  let prevChar = 0;

  TAG_KEYWORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_KEYWORD_RE.exec(text)) !== null) {
    const keyword = match[1];
    if (!TWIG_KEYWORDS.has(keyword)) continue;

    // The keyword starts where match[0] ends minus the keyword length
    const keywordOffset = match.index + match[0].length - keyword.length;
    const pos = doc.positionAt(keywordOffset);

    const deltaLine = pos.line - prevLine;
    const deltaStart = deltaLine === 0 ? pos.character - prevChar : pos.character;

    data.push(deltaLine, deltaStart, keyword.length, KEYWORD_TYPE, 0);

    prevLine = pos.line;
    prevChar = pos.character;
  }

  return { data };
}
