import type {
  SemanticTokens,
  SemanticTokensParams,
  TextDocuments,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

/** Semantic token legend; token type index 0 is `keyword`. */
export const SEMANTIC_TOKEN_LEGEND = {
  tokenTypes: ['keyword'],
  tokenModifiers: [] as string[],
};

const KEYWORD_TYPE = 0;

const TWIG_KEYWORDS = new Set([
  'extends', 'block', 'endblock', 'use',
  'include', 'embed', 'endembed', 'from', 'import', 'as',
  'if', 'elseif', 'else', 'endif',
  'for', 'in', 'endfor',
  'set', 'endset',
  'macro', 'endmacro',
  'apply', 'endapply',
  'filter', 'endfilter',
  'with', 'endwith', 'only',
  'verbatim', 'endverbatim',
  'trans', 'endtrans',
  'cache', 'endcache',
  'not', 'and', 'or', 'is', 'matches',
]);

// Matches `{%` or `{%-` and captures the following word.
const TAG_KEYWORD_RE = /\{%-?\s*(\w+)/g;

/**
 * Returns delta-encoded semantic tokens for all Twig keywords in the document.
 *
 * @param params - LSP semantic tokens request params
 * @param documents - Open document store
 * @returns Delta-encoded semantic tokens
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
