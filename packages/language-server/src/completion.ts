import * as path from 'path';
import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  InsertTextFormat,
  TextDocuments,
  type CompletionParams,
  type CancellationToken,
  TextEdit,
  Range,
  Position,
  MarkupKind,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { SDCRegistry, InvocationContext } from '@drupal-sdc-lsp/core';
import { detectInvocationContext } from '@drupal-sdc-lsp/core';
import type { Logger } from './logger.js';
import { getTwigTagSnippets, getTwigWordSnippets } from './twig-snippets.js';

const MAX_LINE_LENGTH = 10000;

/**
 * Pattern that matches the partial input of an include/embed/extends string literal.
 * Captures everything after the opening quote up to the cursor position.
 *
 * Applied against a small multiline lookback so that the include/embed/extends
 * keyword is found even when it appears on a previous line, e.g.:
 *   {% include
 *     'provider:component' %}
 */
const INCLUDE_CONTEXT_PATTERN = /(?:include|embed|extends)\s*['"]([^'"]*)$/i;

/**
 * Number of previous lines to include when building the multiline lookback
 * for INCLUDE_CONTEXT_PATTERN. 2 is enough for any real-world Twig include.
 */
const INCLUDE_LOOKBACK_LINES = 2;

/**
 * Comment line detection pattern for Twig comment blocks.
 */
const COMMENT_LINE_PATTERN = /^\s*\{#/;

/**
 * Early shorthand prefixes — a single character that could grow into a Twig
 * shorthand but doesn't yet match WORD_SHORTHAND_PATTERN (which requires 2 chars).
 * Returning isIncomplete:true here prevents blink.cmp from caching the empty
 * result and blocking requests once the user types the second character.
 *
 * Covers first letters of: apply, block, cache, embed/extends, filter, for/from,
 * if/include/import, macro, set, trans, use, verbatim, with.
 */
const EARLY_SHORTHAND_PREFIX = /(?<![%{-])\b([abcefimstuvw])$/i;

/**
 * Matches a bare word typed on its own on a line (optional leading whitespace,
 * then 2+ word chars, nothing else up to the cursor). Used to offer
 * `{% include 'provider:component' %}` snippets when the user types a
 * component name like `video` or `hero` outside of any Twig tag.
 */
const BARE_COMPONENT_WORD_PATTERN = /^[ \t]*(\w{2,})$/;

/**
 * Matches an include/embed tag whose component string is already closed, with
 * an optional partial word the user has started typing (e.g. `w`, `wi`, `with`).
 * Applied against `lookbackText` so the component string may span a previous line.
 * Does NOT match once a `{` is typed — at that point the invocation context
 * detector handles it (Branch 2.5).
 */
const TAG_BODY_PATTERN = /\{%-?\s*(?:include|embed)\s+['"][^'"]+['"]\s*([\w]*)$/i;

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
  enableGenericSnippets: boolean = true,
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
  const cursorOffset = doc.offsetAt(params.position);

  // ------------------------------------------------------------------
  // Invocation context guard — runs FIRST, before any snippet branch.
  // If the cursor is inside a `with {}` block we must never reach the
  // tag-snippet or word-shorthand branches; typing `fo` as a prop value
  // must not trigger the `for / endfor` shorthand.
  // ------------------------------------------------------------------
  const invocationCtx = detectInvocationContext(fullText, cursorOffset);
  if (invocationCtx !== null) {
    // At value position (after `key:`) — nothing useful to offer.
    // Twig variable scope resolution is out of scope for this LSP.
    if (/[\w-]+\s*:\s*$/.test(lineUpToCursor)) return [];

    const versionForProps = doc.version;
    await registry.readyPromise;
    if (token.isCancellationRequested) return [];
    const currentDocForProps = documents.get(params.textDocument.uri);
    if (currentDocForProps?.version !== versionForProps) return [];
    return buildPropCompletions(invocationCtx, registry, logger);
  }

  // Multiline lookback — built once, reused by Branch 1.5 and Branch 3.
  // Only computed when we are NOT inside a `with {}` block.
  const lookbackLines = lines
    .slice(Math.max(0, lineNumber - INCLUDE_LOOKBACK_LINES), lineNumber)
    .concat([lineUpToCursor]);
  const lookbackText = lookbackLines.join('\n');

  // ------------------------------------------------------------------
  // Branch 1: inside `{%` tag opener — Twig tag snippets
  // Runs synchronously, no await, no staleness risk.
  // ------------------------------------------------------------------
  const tagSnippets = getTwigTagSnippets(lineUpToCursor, lineAfterCursor, lineNumber, enableGenericSnippets);
  if (tagSnippets.length > 0) return tagSnippets;

  // ------------------------------------------------------------------
  // Branch 1.5: tag-body `with { }` completion — cursor after the
  // component string of an include/embed, before any `{` is typed.
  // Intercepts before Branch 2 so `wi` here does not fall through to
  // the generic `with / endwith` word shorthand.
  // Synchronous — no registry needed.
  // ------------------------------------------------------------------
  const tagBodyMatch = TAG_BODY_PATTERN.exec(lookbackText);
  if (tagBodyMatch !== null) {
    const partialTyped = tagBodyMatch[1] ?? '';
    const wordStart = cursorChar - partialTyped.length;
    const replaceRange = Range.create(
      Position.create(lineNumber, wordStart),
      params.position,
    );
    // isIncomplete:true forces a re-query on every keystroke so blink.cmp's
    // cache never hides this item. filterText is always 'with' so the item
    // stays visible as the user types w → wi → wit → with.
    return CompletionList.create([{
      label: 'with { }',
      kind: CompletionItemKind.Keyword,
      detail: 'Pass variables to the component',
      sortText: '0_with',
      filterText: 'with',
      textEdit: TextEdit.replace(replaceRange, 'with {\n\t${1}\n}'),
      insertTextFormat: InsertTextFormat.Snippet,
    }], true);
  }

  // ------------------------------------------------------------------
  // Branch 2: bare word shorthand (incl, emb, ext…) — word snippets
  // Also synchronous — must run before the registry await.
  // Returns isIncomplete:true so blink.cmp never caches these and always
  // re-requests as the user continues typing.
  // ------------------------------------------------------------------
  const wordSnippets = getTwigWordSnippets(lineUpToCursor, lineNumber, enableGenericSnippets);
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
  // Branch 2.7: bare-word component name search
  // Fires when the line contains only optional whitespace + a 2+ char word
  // that didn't match any Twig shorthand. Lets the user type a component
  // name (e.g. `video`) and receive `{% include 'provider:video' %}` snippets
  // without first having to type `{% include '`.
  // ------------------------------------------------------------------
  const bareWordMatch = BARE_COMPONENT_WORD_PATTERN.exec(lineUpToCursor);
  if (bareWordMatch !== null) {
    const query = bareWordMatch[1];
    const wordStart = lineUpToCursor.length - query.length;
    const replaceRange = Range.create(
      Position.create(lineNumber, wordStart),
      params.position,
    );
    const versionBare = doc.version;
    await registry.readyPromise;
    if (token.isCancellationRequested) return [];
    const currentDocBare = documents.get(params.textDocument.uri);
    if (currentDocBare?.version !== versionBare) return [];
    return CompletionList.create(
      buildBareWordComponentCompletions(query, replaceRange, registry, logger),
      true,
    );
  }

  // ------------------------------------------------------------------
  // Branch 3: inside a string literal after include/embed/extends.
  // Handles both `provider:component` IDs and `@namespace/path.twig` paths.
  // Needs the registry — await + staleness guard applies here only.
  // ------------------------------------------------------------------
  const contextMatch = INCLUDE_CONTEXT_PATTERN.exec(lookbackText);
  if (contextMatch === null) return [];

  const versionAtRequestTime = doc.version;

  await registry.readyPromise;

  if (token.isCancellationRequested) return [];

  const currentDoc = documents.get(params.textDocument.uri);
  if (currentDoc?.version !== versionAtRequestTime) return [];

  const partialInput = contextMatch[1];
  if (partialInput.startsWith('@')) {
    return buildNamespaceCompletions(partialInput, params, currentDoc, registry, logger);
  }

  return buildComponentIdCompletions(partialInput, params, currentDoc, registry, logger);
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
 * Derives the `@provider/relative/path.twig` namespace path from a component's
 * absolute twig file path and provider name. Returns `null` if the `components/`
 * directory cannot be located in the path.
 */
function buildNamespacePath(provider: string, twigFilePath: string): string | null {
  const segments = twigFilePath.split(path.sep);
  const componentsIndex = segments.lastIndexOf('components');
  if (componentsIndex === -1) return null;
  return `@${provider}/${segments.slice(componentsIndex + 1).join('/')}`;
}

/**
 * Builds completion items for `@namespace/path.twig` style includes.
 *
 * @param partialInput - The text already typed (starts with `@`)
 * @param params - LSP completion params
 * @param doc - The current text document
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns Array of namespace path completion items
 */
function buildNamespaceCompletions(
  partialInput: string,
  params: CompletionParams,
  doc: TextDocument,
  registry: SDCRegistry,
  logger: Logger,
): CompletionItem[] {
  const allComponents = registry.getAllComponents();

  if (allComponents.length === 0) {
    logger.debug('No components in registry for namespace completion');
    return [];
  }

  const lineStart = Position.create(params.position.line, 0);
  const lineText = doc.getText(Range.create(lineStart, params.position));
  const partialStart = lineText.length - partialInput.length;

  const replaceRange = Range.create(
    Position.create(params.position.line, partialStart),
    params.position,
  );

  const items: CompletionItem[] = [];

  for (const component of allComponents) {
    if (component.twigFilePath === null) continue;

    const namespacePath = buildNamespacePath(component.provider, component.twigFilePath);
    if (namespacePath === null) continue;
    if (!namespacePath.startsWith(partialInput)) continue;

    items.push({
      label: namespacePath,
      kind: CompletionItemKind.File,
      detail: component.name,
      data: component.id,
      textEdit: TextEdit.replace(replaceRange, namespacePath),
    });
  }

  for (const entry of registry.getAllTwigEntries()) {
    if (!entry.namespacePath.startsWith(partialInput)) continue;
    items.push({
      label: entry.namespacePath,
      kind: CompletionItemKind.File,
      detail: 'Template',
      textEdit: TextEdit.replace(replaceRange, entry.namespacePath),
    });
  }

  return items;
}

/**
 * Builds completion items for props and slots of the component being invoked
 * inside a Twig `include/embed ... with { }` block.
 *
 * Required props sort before optional ones. Keys already typed are excluded.
 *
 * @param ctx - The detected invocation context (component ID + used keys)
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns Array of prop/slot completion items
 */
function buildPropCompletions(
  ctx: InvocationContext,
  registry: SDCRegistry,
  logger: Logger,
): CompletionItem[] {
  const component = registry.getById(ctx.componentId);
  if (component === undefined) {
    logger.debug(`No component found for prop completions: ${ctx.componentId}`);
    return [];
  }

  const usedKeys = new Set(ctx.alreadyUsedKeys);
  const items: CompletionItem[] = [];

  for (const prop of component.props) {
    if (usedKeys.has(prop.name)) continue;

    const descParts: string[] = [];
    if (prop.description !== undefined) descParts.push(prop.description);
    if (prop.default !== undefined) descParts.push(`(default: \`${String(prop.default)}\`)`);

    items.push({
      label: prop.name,
      kind: CompletionItemKind.Field,
      detail: prop.type,
      sortText: prop.required ? `0_${prop.name}` : `1_${prop.name}`,
      documentation: descParts.length > 0
        ? { kind: MarkupKind.Markdown, value: descParts.join(' ') }
        : undefined,
      insertText: `${prop.name}: `,
    });
  }

  for (const slot of component.slots) {
    if (usedKeys.has(slot.name)) continue;

    items.push({
      label: slot.name,
      kind: CompletionItemKind.Value,
      detail: 'slot',
      sortText: `2_${slot.name}`,
      documentation: slot.description !== undefined
        ? { kind: MarkupKind.Markdown, value: slot.description }
        : undefined,
      insertText: `${slot.name}: `,
    });
  }

  return items;
}

/**
 * Builds `{% include %}` and `{% include with {} %}` snippets for components
 * whose ID or name matches `query` (case-insensitive substring).
 * Used by the bare-word typing branch so `video` → `{% include 'numiko:video' %}`.
 *
 * @param query - The bare word the user typed
 * @param replaceRange - Range covering the typed word
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns Include snippet completions for all matching components
 */
function buildBareWordComponentCompletions(
  query: string,
  replaceRange: Range,
  registry: SDCRegistry,
  logger: Logger,
): CompletionItem[] {
  const matches = registry.search(query);
  if (matches.length === 0) {
    logger.debug(`No components matched bare-word query: ${query}`);
    return [];
  }

  // filterText is always the raw query the user typed.
  // This means the server owns all filtering (via registry.search / path substring
  // check above) and blink.cmp's client-side prefix filter never hides items whose
  // full ID or path doesn't happen to start with the typed word.
  const items: CompletionItem[] = [];

  for (const component of matches) {
    // Component-ID form: {% include 'provider:component' %}
    items.push({
      label: `{% include '${component.id}' %}`,
      kind: CompletionItemKind.Snippet,
      detail: component.name,
      sortText: `0_${component.id}`,
      filterText: query,
      textEdit: TextEdit.replace(replaceRange, `{% include '${component.id}' %}`),
      insertTextFormat: InsertTextFormat.Snippet,
    });
    items.push({
      label: `{% include '${component.id}' with {} %}`,
      kind: CompletionItemKind.Snippet,
      detail: component.name,
      sortText: `1_${component.id}`,
      filterText: query,
      textEdit: TextEdit.replace(replaceRange, `{% include '${component.id}' with {\n\t\${1}\n} %}`),
      insertTextFormat: InsertTextFormat.Snippet,
    });

    // Namespace-path form: {% include '@provider/path/component.twig' %}
    if (component.twigFilePath !== null) {
      const namespacePath = buildNamespacePath(component.provider, component.twigFilePath);
      if (namespacePath !== null) {
        items.push({
          label: `{% include '${namespacePath}' %}`,
          kind: CompletionItemKind.Snippet,
          detail: component.name,
          sortText: `2_${component.id}`,
          filterText: query,
          textEdit: TextEdit.replace(replaceRange, `{% include '${namespacePath}' %}`),
          insertTextFormat: InsertTextFormat.Snippet,
        });
        items.push({
          label: `{% include '${namespacePath}' with {} %}`,
          kind: CompletionItemKind.Snippet,
          detail: component.name,
          sortText: `3_${component.id}`,
          filterText: query,
          textEdit: TextEdit.replace(replaceRange, `{% include '${namespacePath}' with {\n\t\${1}\n} %}`),
          insertTextFormat: InsertTextFormat.Snippet,
        });
      }
    }
  }

  // Non-SDC standalone template files whose namespace path contains the query
  const lowerQuery = query.toLowerCase();
  for (const entry of registry.getAllTwigEntries()) {
    if (!entry.namespacePath.toLowerCase().includes(lowerQuery)) continue;
    items.push({
      label: `{% include '${entry.namespacePath}' %}`,
      kind: CompletionItemKind.Snippet,
      detail: 'Template',
      sortText: `4_${entry.namespacePath}`,
      filterText: query,
      textEdit: TextEdit.replace(replaceRange, `{% include '${entry.namespacePath}' %}`),
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  return items;
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
