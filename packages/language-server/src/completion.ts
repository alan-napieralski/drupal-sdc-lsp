import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  TextDocuments,
  type CompletionParams,
  type CancellationToken,
  TextEdit,
  Range,
  Position,
  MarkupKind,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { SDCRegistry } from '@drupal-sdc-lsp/core';
import type { Logger } from './logger.js';
import { getTwigTagSnippets, getTwigWordSnippets } from './twig-snippets.js';

const MAX_LINE_LENGTH = 10000;

/**
 * Pattern that matches the partial input of an include/embed/extends string literal.
 * Captures everything after the opening quote up to the cursor position.
 */
const INCLUDE_CONTEXT_PATTERN = /(?:include|embed|extends)\s*['"]([^'"]*)$/i;

/**
 * Comment line detection pattern for Twig comment blocks.
 */
const COMMENT_LINE_PATTERN = /^\s*\{#/;

/**
 * Early shorthand prefixes — not yet long enough to match WORD_SHORTHAND_PATTERN
 * but are plausible starts of a Twig shorthand. Returning isIncomplete:true here
 * prevents blink.cmp from caching the empty result and blocking later requests.
 */
const EARLY_SHORTHAND_PREFIX = /(?<![%{-])\b([ie][mn]?)$/i;

/**
 * Returns completion items for the current cursor position in a Twig document.
 *
 * Snippet branches (tag and word) run BEFORE the registry await so they are
 * never killed by the version-staleness check — they don't depend on the
 * registry and must respond on every keystroke without async delay.
 *
 * Only the component-ID branch awaits the registry.
 *
 * @param params - LSP completion request parameters
 * @param documents - Open document store
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @param token - Cancellation token from the LSP client
 * @returns Array of completion items (never null)
 */
export async function getCompletions(
  params: CompletionParams,
  documents: TextDocuments<TextDocument>,
  registry: SDCRegistry,
  logger: Logger,
  token: CancellationToken,
): Promise<CompletionItem[]> {
  const doc = documents.get(params.textDocument.uri);
  if (doc === undefined) return [];

  const fullText = doc.getText();
  const lines = fullText.split('\n');
  const lineNumber = params.position.line;
  const fullLine = lines[lineNumber] ?? '';

  if (fullLine.length > MAX_LINE_LENGTH) {
    logger.debug(`Line too long for completion (${fullLine.length} chars), skipping`);
    return [];
  }

  if (COMMENT_LINE_PATTERN.test(fullLine)) return [];

  const cursorChar = params.position.character;
  const lineUpToCursor = fullLine.slice(0, cursorChar);
  const lineAfterCursor = fullLine.slice(cursorChar);

  // ------------------------------------------------------------------
  // Branch 1: inside `{%` tag opener — Twig tag snippets
  // Runs synchronously, no await, no staleness risk.
  // ------------------------------------------------------------------
  const tagSnippets = getTwigTagSnippets(lineUpToCursor, lineAfterCursor, lineNumber);
  if (tagSnippets.length > 0) return tagSnippets;

  // ------------------------------------------------------------------
  // Branch 2: bare word shorthand (incl, emb, ext…) — word snippets
  // Also synchronous — must run before the registry await.
  // Returns isIncomplete:true so blink.cmp never caches these and always
  // re-requests as the user continues typing.
  // ------------------------------------------------------------------
  const wordSnippets = getTwigWordSnippets(lineUpToCursor, lineNumber);
  if (wordSnippets.length > 0) {
    return CompletionList.create(wordSnippets, true);
  }

  // Early shorthand prefix (e.g. `i`, `in`, `e`, `em`) — pattern not matched
  // yet but could grow into one. Signal incomplete to break blink.cmp's cache
  // so the next keystroke gets a fresh request rather than filtering empty.
  if (EARLY_SHORTHAND_PREFIX.test(lineUpToCursor)) {
    return CompletionList.create([], true);
  }

  // ------------------------------------------------------------------
  // Branch 3: inside a string literal after include/embed/extends
  // Needs the registry — await + staleness guard applies here only.
  // ------------------------------------------------------------------
  const contextMatch = INCLUDE_CONTEXT_PATTERN.exec(lineUpToCursor);
  if (contextMatch === null) return [];

  const versionAtRequestTime = doc.version;

  await registry.readyPromise;

  if (token.isCancellationRequested) return [];

  const currentDoc = documents.get(params.textDocument.uri);
  if (currentDoc?.version !== versionAtRequestTime) return [];

  return buildComponentIdCompletions(contextMatch[1], params, currentDoc, registry, logger);
}

/**
 * Builds completion items for SDC component IDs.
 *
 * @param partialInput - The text already typed inside the string literal
 * @param params - LSP completion params (for position info)
 * @param doc - The current text document
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns Array of component ID completion items
 */
function buildComponentIdCompletions(
  partialInput: string,
  params: CompletionParams,
  doc: TextDocument,
  registry: SDCRegistry,
  logger: Logger,
): CompletionItem[] {
  const allComponents = registry.getAllComponents();

  if (allComponents.length === 0) {
    logger.debug('No components in registry for completion');
    return [];
  }

  const lineStart = Position.create(params.position.line, 0);
  const lineText = doc.getText(Range.create(lineStart, params.position));
  const partialStart = lineText.length - partialInput.length;

  const replaceRange = Range.create(
    Position.create(params.position.line, partialStart),
    params.position,
  );

  return allComponents.map((component) => ({
    label: component.id,
    kind: CompletionItemKind.Module,
    detail: component.name,
    data: component.id,
    textEdit: TextEdit.replace(replaceRange, component.id),
  }));
}

/**
 * Resolves a completion item by populating its full documentation.
 *
 * Called by the LSP client after the user highlights a completion item.
 * The `item.data` field must contain the component ID string.
 *
 * @param item - The completion item to resolve
 * @param registry - SDC component registry
 * @returns The same item with `documentation` populated
 */
export function resolveCompletion(item: CompletionItem, registry: SDCRegistry): CompletionItem {
  const componentId = typeof item.data === 'string' ? item.data : null;
  if (componentId === null) return item;

  const component = registry.getById(componentId);
  if (component === undefined) return item;

  const lines: string[] = [`### ${component.name}`];
  if (component.description !== undefined) {
    lines.push('', component.description);
  }

  return {
    ...item,
    documentation: {
      kind: MarkupKind.Markdown,
      value: lines.join('\n'),
    },
  };
}
