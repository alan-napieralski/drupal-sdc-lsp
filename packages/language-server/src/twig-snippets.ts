import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  Range,
  Position,
  TextEdit,
} from 'vscode-languageserver/node.js';

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Matches the opening of a Twig tag at end of line, capturing:
 *   [1] the opener itself (`{%` or `{%-`)
 *   [2] any whitespace + partial keyword already typed
 *
 * E.g. `{% inc` → opener=`{%`, rest=` inc`
 */
const TWIG_TAG_OPENER = /(\{%-?)(\s*\w*)$/;

/**
 * Matches a bare word shorthand that is NOT inside a Twig tag.
 * Captures the partial word typed.
 *
 * Supported prefixes: incl(ude)(w), emb(ed)(w), ext(ends)
 */
const WORD_SHORTHAND_PATTERN = /(?<![%{-])\b(incl?\w*|emb?\w*|ext\w*)$/i;

// ---------------------------------------------------------------------------
// Snippet definitions
// ---------------------------------------------------------------------------

interface SnippetDef {
  label: string;
  /** Keyword that goes after `{% ` — used to filter by partial input */
  keyword: string;
  /** Full snippet body starting after `{% ` (for tag context) */
  tagBody: string;
  /** Full snippet including `{% ` opener (for word context) */
  fullSnippet: string;
  detail: string;
  documentation: string;
  sortText: string;
}

const SNIPPET_DEFS: SnippetDef[] = [
  {
    label: 'include',
    keyword: 'include',
    tagBody: "include '${1:provider:component}' %}",
    fullSnippet: "{% include '${1:provider:component}' %}",
    detail: 'Twig include tag',
    documentation: "{% include 'provider:component' %}",
    sortText: '0_include',
  },
  {
    label: 'include with',
    keyword: 'include',
    tagBody: "include '${1:provider:component}' with { ${2} } %}",
    fullSnippet: "{% include '${1:provider:component}' with { ${2} } %}",
    detail: 'Twig include with variables',
    documentation: "{% include 'provider:component' with { key: value } %}",
    sortText: '0_include_with',
  },
  {
    label: 'embed',
    keyword: 'embed',
    tagBody: "embed '${1:provider:component}' %}\n  ${2}\n{% endembed %}",
    fullSnippet: "{% embed '${1:provider:component}' %}\n  ${2}\n{% endembed %}",
    detail: 'Twig embed tag',
    documentation: '{% embed ... %}  {% endembed %}',
    sortText: '0_embed',
  },
  {
    label: 'embed with',
    keyword: 'embed',
    tagBody: "embed '${1:provider:component}' with { ${2} } %}\n  ${3}\n{% endembed %}",
    fullSnippet: "{% embed '${1:provider:component}' with { ${2} } %}\n  ${3}\n{% endembed %}",
    detail: 'Twig embed with variables',
    documentation: '{% embed ... with { } %}  {% endembed %}',
    sortText: '0_embed_with',
  },
  {
    label: 'extends',
    keyword: 'extends',
    tagBody: "extends '${1:provider:component}' %}",
    fullSnippet: "{% extends '${1:provider:component}' %}",
    detail: 'Twig extends tag',
    documentation: "{% extends 'provider:component' %}",
    sortText: '0_extends',
  },
];

// ---------------------------------------------------------------------------
// Word-level shorthand triggers
// ---------------------------------------------------------------------------

interface WordTrigger {
  /** Shorthand the user types (e.g. `incl`, `inclw`) */
  shorthand: string;
  /** Which SnippetDef label to use */
  label: string;
}

const WORD_TRIGGERS: WordTrigger[] = [
  { shorthand: 'include', label: 'include' },
  { shorthand: 'incl',    label: 'include' },
  { shorthand: 'includew', label: 'include with' },
  { shorthand: 'inclw',   label: 'include with' },
  { shorthand: 'embed',   label: 'embed' },
  { shorthand: 'emb',     label: 'embed' },
  { shorthand: 'embedw',  label: 'embed with' },
  { shorthand: 'embw',    label: 'embed with' },
  { shorthand: 'extends', label: 'extends' },
  { shorthand: 'ext',     label: 'extends' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns tag snippet completions when the cursor is inside an opening `{%`
 * tag. Uses a `textEdit` to replace the entire opener (including any trailing
 * auto-closed `}`) so the result is correctly spaced and brace-balanced.
 *
 * @param lineUpToCursor  - Line text from column 0 to cursor
 * @param lineAfterCursor - Line text from cursor to end of line
 * @param lineNumber      - Zero-based line number
 */
export function getTwigTagSnippets(
  lineUpToCursor: string,
  lineAfterCursor: string,
  lineNumber: number,
): CompletionItem[] {
  const openerMatch = TWIG_TAG_OPENER.exec(lineUpToCursor);
  if (openerMatch === null) return [];

  const partial = openerMatch[2].trim().toLowerCase();

  // Range start: where the `{%` opener begins
  const openerStart = openerMatch.index;
  // Range end: cursor position, extended by 1 if the next char is a lone `}`
  // (auto-close inserted it and our snippet already ends with `%}`)
  const cursorChar = lineUpToCursor.length;
  const hasAutoCloseBrace = lineAfterCursor.startsWith('}') && !lineAfterCursor.startsWith('%}');
  const rangeEndChar = cursorChar + (hasAutoCloseBrace ? 1 : 0);

  const replaceRange = Range.create(
    Position.create(lineNumber, openerStart),
    Position.create(lineNumber, rangeEndChar),
  );

  const matchingDefs =
    partial === ''
      ? SNIPPET_DEFS
      : SNIPPET_DEFS.filter((d) => d.keyword.startsWith(partial) || d.label.startsWith(partial));

  return matchingDefs.map((d) => ({
    label: d.label,
    kind: CompletionItemKind.Snippet,
    detail: d.detail,
    documentation: d.documentation,
    filterText: lineUpToCursor.slice(openerStart),
    textEdit: TextEdit.replace(replaceRange, d.fullSnippet),
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: d.sortText,
  }));
}

/**
 * Returns word-level snippet completions for bare shorthands like `incl`,
 * `emb`, `ext`. Uses a `textEdit` to replace the typed word entirely.
 *
 * This function is synchronous and must be called BEFORE any `await` in the
 * completion handler to avoid the async-gap staleness check killing results.
 *
 * @param lineUpToCursor - Line text from column 0 to cursor
 * @param lineNumber     - Zero-based line number
 */
export function getTwigWordSnippets(
  lineUpToCursor: string,
  lineNumber: number,
): CompletionItem[] {
  const match = WORD_SHORTHAND_PATTERN.exec(lineUpToCursor);
  if (match === null) return [];

  const typed = match[1].toLowerCase();
  const wordStart = lineUpToCursor.length - match[1].length;

  const replaceRange = Range.create(
    Position.create(lineNumber, wordStart),
    Position.create(lineNumber, lineUpToCursor.length),
  );

  // Find all triggers whose shorthand starts with what was typed
  const matchingTriggers = WORD_TRIGGERS.filter((t) => t.shorthand.startsWith(typed));

  // Deduplicate by label (multiple shorthands can point to the same snippet)
  const seenLabels = new Set<string>();
  const items: CompletionItem[] = [];

  for (const trigger of matchingTriggers) {
    if (seenLabels.has(trigger.label)) continue;
    seenLabels.add(trigger.label);

    const def = SNIPPET_DEFS.find((d) => d.label === trigger.label);
    if (def === undefined) continue;

    items.push({
      label: def.label,
      kind: CompletionItemKind.Snippet,
      detail: def.detail,
      documentation: def.documentation,
      // Use the primary trigger word (e.g. `include`) not the typed partial
      // so blink.cmp's fuzzy matcher scores `incl` → `include` as a prefix hit
      filterText: trigger.shorthand,
      textEdit: TextEdit.replace(replaceRange, def.fullSnippet),
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: def.sortText,
    });
  }

  return items;
}
