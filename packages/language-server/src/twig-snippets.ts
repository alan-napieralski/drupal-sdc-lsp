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
 */
const TWIG_TAG_OPENER = /(\{%-?)(\s*\w*)$/;

/**
 * Matches a bare word shorthand that is NOT already inside a Twig tag.
 * Captures the partial word typed so far.
 *
 * Uses 2-character minimums so that prefixes like `ex`, `bl`, `ma` etc. already
 * trigger completions — blink.cmp will never see an isIncomplete:false empty
 * result at 2 chars and cache it before the user reaches the 3-char threshold.
 */
const WORD_SHORTHAND_PATTERN = /(?<![%{-])\b(in\w*|em\w*|ex\w*|if\w*|fo\w*|bl\w*|se\w*|ma\w*|ap\w*|wi\w*|ve\w*|im\w*|fr\w*|tr\w*|ca\w*|fi\w*|us\w*)$/i;

// ---------------------------------------------------------------------------
// Snippet definitions
// ---------------------------------------------------------------------------

interface SnippetDef {
  /** Label shown in completion menu — uses `{% ... %}` style to distinguish from twiggy's bare labels */
  label: string;
  /** Keyword(s) that trigger this in a `{%` context */
  keywords: string[];
  /** Full snippet text (always starts with `{% `) */
  fullSnippet: string;
  detail: string;
  sortText: string;
  /** If true, only shown when generic Twig snippets are enabled */
  generic: boolean;
}

const SNIPPET_DEFS: SnippetDef[] = [
  // -------------------------------------------------------------------------
  // SDC-specific — always shown (these fill gaps twiggy doesn't handle)
  // -------------------------------------------------------------------------
  {
    label: 'include',
    keywords: ['include'],
    fullSnippet: "{% include '${1:provider:component}' %}",
    detail: 'Include a Twig template or SDC component',
    sortText: '0_include',
    generic: false,
  },
  {
    label: 'include with',
    keywords: ['include'],
    fullSnippet: "{% include '${1:provider:component}' with {\n\t${2}\n} %}",
    detail: 'Include with variables',
    sortText: '0_include_with',
    generic: false,
  },
  {
    label: 'embed',
    keywords: ['embed'],
    fullSnippet: "{% embed '${1:provider:component}' %}\n\t${2}\n{% endembed %}",
    detail: 'Embed a template (overridable blocks)',
    sortText: '0_embed',
    generic: false,
  },
  {
    label: 'embed with',
    keywords: ['embed'],
    fullSnippet: "{% embed '${1:provider:component}' with {\n\t${2}\n} %}\n\t${3}\n{% endembed %}",
    detail: 'Embed with variables',
    sortText: '0_embed_with',
    generic: false,
  },
  {
    label: 'extends',
    keywords: ['extends'],
    fullSnippet: "{% extends '${1:provider:component}' %}",
    detail: 'Extend a parent template',
    sortText: '0_extends',
    generic: false,
  },

  // -------------------------------------------------------------------------
  // Generic Twig — shown when enableGenericTwigSnippets is true
  // Labels deliberately differ from twiggy's bare `if`/`for` to avoid
  // blink.cmp showing duplicates. Ours are full snippets; twiggy's are stubs.
  // -------------------------------------------------------------------------
  {
    label: 'if / endif',
    keywords: ['if'],
    fullSnippet: "{% if ${1:condition} %}\n\t${2}\n{% endif %}",
    detail: 'If block',
    sortText: '1_if',
    generic: true,
  },
  {
    label: 'if / else / endif',
    keywords: ['if'],
    fullSnippet: "{% if ${1:condition} %}\n\t${2}\n{% else %}\n\t${3}\n{% endif %}",
    detail: 'If/else block',
    sortText: '1_if_else',
    generic: true,
  },
  {
    label: 'if / elseif / else / endif',
    keywords: ['if'],
    fullSnippet: "{% if ${1:condition} %}\n\t${2}\n{% elseif ${3:condition} %}\n\t${4}\n{% else %}\n\t${5}\n{% endif %}",
    detail: 'If/elseif/else block',
    sortText: '1_if_elseif',
    generic: true,
  },
  {
    label: 'for / endfor',
    keywords: ['for'],
    fullSnippet: "{% for ${1:item} in ${2:items} %}\n\t${3}\n{% endfor %}",
    detail: 'For loop',
    sortText: '1_for',
    generic: true,
  },
  {
    label: 'for / else / endfor',
    keywords: ['for'],
    fullSnippet: "{% for ${1:item} in ${2:items} %}\n\t${3}\n{% else %}\n\t${4}\n{% endfor %}",
    detail: 'For loop with empty fallback',
    sortText: '1_for_else',
    generic: true,
  },
  {
    label: 'block / endblock',
    keywords: ['block'],
    fullSnippet: "{% block ${1:name} %}\n\t${2}\n{% endblock %}",
    detail: 'Template block',
    sortText: '1_block',
    generic: true,
  },
  {
    label: 'set',
    keywords: ['set'],
    fullSnippet: "{% set ${1:variable} = ${2:value} %}",
    detail: 'Assign a variable',
    sortText: '1_set',
    generic: true,
  },
  {
    label: 'set / endset',
    keywords: ['set'],
    fullSnippet: "{% set ${1:variable} %}\n\t${2}\n{% endset %}",
    detail: 'Assign a block of content to a variable',
    sortText: '1_set_block',
    generic: true,
  },
  {
    label: 'macro / endmacro',
    keywords: ['macro'],
    fullSnippet: "{% macro ${1:name}(${2:args}) %}\n\t${3}\n{% endmacro %}",
    detail: 'Define a reusable macro',
    sortText: '1_macro',
    generic: true,
  },
  {
    label: 'apply / endapply',
    keywords: ['apply'],
    fullSnippet: "{% apply ${1:filter} %}\n\t${2}\n{% endapply %}",
    detail: 'Apply a filter to a block of content',
    sortText: '1_apply',
    generic: true,
  },
  {
    label: 'with / endwith',
    keywords: ['with'],
    fullSnippet: "{% with ${1:variables} %}\n\t${2}\n{% endwith %}",
    detail: 'Create a new variable scope',
    sortText: '1_with',
    generic: true,
  },
  {
    label: 'with only / endwith',
    keywords: ['with'],
    fullSnippet: "{% with ${1:variables} only %}\n\t${2}\n{% endwith %}",
    detail: 'Create a new isolated variable scope',
    sortText: '1_with_only',
    generic: true,
  },
  {
    label: 'verbatim / endverbatim',
    keywords: ['verbatim'],
    fullSnippet: "{% verbatim %}\n\t${1}\n{% endverbatim %}",
    detail: 'Output Twig syntax literally without processing',
    sortText: '1_verbatim',
    generic: true,
  },
  {
    label: 'filter / endfilter',
    keywords: ['filter'],
    fullSnippet: "{% filter ${1:filter} %}\n\t${2}\n{% endfilter %}",
    detail: 'Apply a filter to a block (deprecated, prefer apply)',
    sortText: '1_filter',
    generic: true,
  },
  {
    label: 'import',
    keywords: ['import'],
    fullSnippet: "{% import '${1:template}' as ${2:alias} %}",
    detail: 'Import macros from a template',
    sortText: '1_import',
    generic: true,
  },
  {
    label: 'from / import',
    keywords: ['from'],
    fullSnippet: "{% from '${1:template}' import ${2:macro} %}",
    detail: 'Import specific macros from a template',
    sortText: '1_from',
    generic: true,
  },
  {
    label: 'use',
    keywords: ['use'],
    fullSnippet: "{% use '${1:template}' %}",
    detail: 'Import blocks from another template (horizontal reuse)',
    sortText: '1_use',
    generic: true,
  },
  {
    label: 'trans / endtrans',
    keywords: ['trans'],
    fullSnippet: "{% trans %}\n\t${1}\n{% endtrans %}",
    detail: 'Translate a block of text',
    sortText: '1_trans',
    generic: true,
  },
  {
    label: 'cache / endcache',
    keywords: ['cache'],
    fullSnippet: "{% cache '${1:key}' %}\n\t${2}\n{% endcache %}",
    detail: 'Cache a block of content',
    sortText: '1_cache',
    generic: true,
  },
];

// ---------------------------------------------------------------------------
// Word-level shorthand map
// Maps typed prefix → snippet label
// ---------------------------------------------------------------------------

interface WordTrigger {
  shorthand: string;
  label: string;
}

const WORD_TRIGGERS: WordTrigger[] = [
  // SDC-specific
  { shorthand: 'include',  label: 'include' },
  { shorthand: 'incl',     label: 'include' },
  { shorthand: 'includew', label: 'include with' },
  { shorthand: 'inclw',    label: 'include with' },
  { shorthand: 'embed',    label: 'embed' },
  { shorthand: 'emb',      label: 'embed' },
  { shorthand: 'embedw',   label: 'embed with' },
  { shorthand: 'embw',     label: 'embed with' },
  { shorthand: 'extends',  label: 'extends' },
  { shorthand: 'ext',      label: 'extends' },
  // Generic
  { shorthand: 'if',       label: 'if / endif' },
  { shorthand: 'ife',      label: 'if / else / endif' },
  { shorthand: 'for',      label: 'for / endfor' },
  { shorthand: 'fore',     label: 'for / else / endfor' },
  { shorthand: 'block',    label: 'block / endblock' },
  { shorthand: 'blo',      label: 'block / endblock' },
  { shorthand: 'set',      label: 'set' },
  { shorthand: 'setb',     label: 'set / endset' },
  { shorthand: 'macro',    label: 'macro / endmacro' },
  { shorthand: 'mac',      label: 'macro / endmacro' },
  { shorthand: 'apply',    label: 'apply / endapply' },
  { shorthand: 'app',      label: 'apply / endapply' },
  { shorthand: 'with',     label: 'with / endwith' },
  { shorthand: 'withon',   label: 'with only / endwith' },
  { shorthand: 'verbatim', label: 'verbatim / endverbatim' },
  { shorthand: 'verb',     label: 'verbatim / endverbatim' },
  { shorthand: 'import',   label: 'import' },
  { shorthand: 'imp',      label: 'import' },
  { shorthand: 'from',     label: 'from / import' },
  { shorthand: 'fro',      label: 'from / import' },
  { shorthand: 'trans',    label: 'trans / endtrans' },
  { shorthand: 'tra',      label: 'trans / endtrans' },
  { shorthand: 'cache',    label: 'cache / endcache' },
  { shorthand: 'cac',      label: 'cache / endcache' },
  { shorthand: 'filter',   label: 'filter / endfilter' },
  { shorthand: 'fil',      label: 'filter / endfilter' },
  { shorthand: 'use',      label: 'use' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns tag snippet completions when the cursor is inside an opening `{%`
 * tag. Uses `textEdit` to replace the entire opener (including any trailing
 * auto-closed `}`) so the result is correctly spaced and brace-balanced.
 *
 * Twiggy returns bare keyword labels (`if`, `block`).
 * We return full-snippet labels (`if / endif`, `block / endblock`).
 * Different labels = no deduplication collision in blink.cmp.
 *
 * @param lineUpToCursor       - Line text from column 0 to cursor
 * @param lineAfterCursor      - Line text from cursor to end of line
 * @param lineNumber           - Zero-based line number
 * @param enableGenericSnippets - Whether to include generic Twig snippets
 */
export function getTwigTagSnippets(
  lineUpToCursor: string,
  lineAfterCursor: string,
  lineNumber: number,
  enableGenericSnippets: boolean,
): CompletionItem[] {
  const openerMatch = TWIG_TAG_OPENER.exec(lineUpToCursor);
  if (openerMatch === null) return [];

  const partial = openerMatch[2].trim().toLowerCase();
  const openerStart = openerMatch.index;
  const cursorChar = lineUpToCursor.length;

  // Consume a trailing auto-closed `}` so we don't end up with `%}}`
  const hasAutoCloseBrace =
    lineAfterCursor.startsWith('}') && !lineAfterCursor.startsWith('%}');
  // Also consume a trailing `%}` (with optional leading space or `-`) that the
  // editor auto-inserted when the user opened the `{%` tag, so we don't end up
  // with `{% include '...' %} %}`.
  const tagCloseMatch = /^[ \t]*-?%\}/.exec(lineAfterCursor);
  const rangeEndChar =
    cursorChar + (hasAutoCloseBrace ? 1 : tagCloseMatch !== null ? tagCloseMatch[0].length : 0);

  const replaceRange = Range.create(
    Position.create(lineNumber, openerStart),
    Position.create(lineNumber, rangeEndChar),
  );

  const matchingDefs = SNIPPET_DEFS.filter((d) => {
    if (d.generic && !enableGenericSnippets) return false;
    if (partial === '') return true;
    return d.keywords.some((k) => k.startsWith(partial)) || d.label.startsWith(partial);
  });

  return matchingDefs.map((d) => ({
    label: d.label,
    kind: CompletionItemKind.Snippet,
    detail: d.detail,
    filterText: lineUpToCursor.slice(openerStart),
    textEdit: TextEdit.replace(replaceRange, d.fullSnippet),
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: d.sortText,
  }));
}

/**
 * Returns word-level Twig snippet completions for bare shorthands.
 * Uses `textEdit` to replace the typed word entirely with the full snippet.
 *
 * Must be called BEFORE any `await` in the completion handler to avoid the
 * async-gap staleness check killing results on every keystroke.
 *
 * @param lineUpToCursor        - Line text from column 0 to cursor
 * @param lineNumber            - Zero-based line number
 * @param enableGenericSnippets - Whether to include generic Twig snippets
 */
export function getTwigWordSnippets(
  lineUpToCursor: string,
  lineNumber: number,
  enableGenericSnippets: boolean,
): CompletionItem[] {
  const match = WORD_SHORTHAND_PATTERN.exec(lineUpToCursor);
  if (match === null) return [];

  const typed = match[1].toLowerCase();
  const wordStart = lineUpToCursor.length - match[1].length;

  const replaceRange = Range.create(
    Position.create(lineNumber, wordStart),
    Position.create(lineNumber, lineUpToCursor.length),
  );

  const matchingTriggers = WORD_TRIGGERS.filter((t) => t.shorthand.startsWith(typed));

  const seenLabels = new Set<string>();
  const items: CompletionItem[] = [];

  for (const trigger of matchingTriggers) {
    if (seenLabels.has(trigger.label)) continue;
    seenLabels.add(trigger.label);

    const def = SNIPPET_DEFS.find((d) => d.label === trigger.label);
    if (def === undefined) continue;
    if (def.generic && !enableGenericSnippets) continue;

    items.push({
      label: def.label,
      kind: CompletionItemKind.Snippet,
      detail: def.detail,
      filterText: trigger.shorthand,
      textEdit: TextEdit.replace(replaceRange, def.fullSnippet),
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: def.sortText,
    });
  }

  return items;
}
