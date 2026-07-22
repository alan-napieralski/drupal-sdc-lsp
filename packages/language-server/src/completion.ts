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
import { SERVER_NAME } from './metadata.js';

const MAX_LINE_LENGTH = 10000;

const SOURCE_LABEL = SERVER_NAME;

// Matches the partial include/embed/extends string literal up to the cursor.
const INCLUDE_CONTEXT_PATTERN = /(?:include|embed|extends)\s*['"]([^'"]*)$/i;

const INCLUDE_LOOKBACK_LINES = 2;

const COMMENT_LINE_PATTERN = /^\s*\{#/;

// Matches a single leading char that could grow into a Twig shorthand;
// returning isIncomplete:true for it keeps the client re-querying each keystroke.
const EARLY_SHORTHAND_PREFIX = /(?<![%{-])\b([abcefimstuvw])$/i;

// Matches a bare 2+ char word alone on a line.
const BARE_COMPONENT_WORD_PATTERN = /^[ \t]*(\w{2,})$/;

// Matches an include/embed with a closed component string and an optional trailing partial word.
const TAG_BODY_PATTERN = /\{%-?\s*(?:include|embed)\s+['"][^'"]+['"]\s*([\w]*)$/i;

/**
 * Returns completion items for the cursor position, tagged with the source label.
 *
 * @param params - LSP completion request parameters
 * @param documents - Open document store
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @param token - Cancellation token from the LSP client
 * @param enableGenericSnippets - Whether to include generic Twig snippets
 * @returns Completion items, or a completion list
 */
export async function getCompletions(
  params: CompletionParams,
  documents: TextDocuments<TextDocument>,
  registry: SDCRegistry,
  logger: Logger,
  token: CancellationToken,
  enableGenericSnippets: boolean = true,
): Promise<CompletionItem[] | CompletionList> {
  const result = await collectCompletions(
    params,
    documents,
    registry,
    logger,
    token,
    enableGenericSnippets,
  );
  return tagWithSource(result);
}

/**
 * Stamps every completion item with the source label.
 *
 * @param result - Completion items or list to tag
 * @returns The same result with each item's source label set
 */
function tagWithSource(
  result: CompletionItem[] | CompletionList,
): CompletionItem[] | CompletionList {
  const items = Array.isArray(result) ? result : result.items;
  for (const item of items) {
    item.labelDetails = { ...item.labelDetails, description: SOURCE_LABEL };
  }
  return result;
}

/**
 * Selects the appropriate completion branch for the cursor position.
 *
 * Snippet branches run before the registry await so they are never dropped
 * by the version-staleness check.
 *
 * @param params - LSP completion request parameters
 * @param documents - Open document store
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @param token - Cancellation token from the LSP client
 * @param enableGenericSnippets - Whether to include generic Twig snippets
 * @returns Completion items, or a completion list
 */
async function collectCompletions(
  params: CompletionParams,
  documents: TextDocuments<TextDocument>,
  registry: SDCRegistry,
  logger: Logger,
  token: CancellationToken,
  enableGenericSnippets: boolean = true,
): Promise<CompletionItem[] | CompletionList> {
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

  const invocationCtx = detectInvocationContext(fullText, cursorOffset);
  if (invocationCtx !== null) {
    if (/[\w-]+\s*:\s*$/.test(lineUpToCursor)) return [];

    const versionForProps = doc.version;
    await registry.readyPromise;
    if (token.isCancellationRequested) return [];
    const currentDocForProps = documents.get(params.textDocument.uri);
    if (currentDocForProps?.version !== versionForProps) return [];
    return buildPropCompletions(invocationCtx, registry, logger);
  }

  const lookbackLines = lines
    .slice(Math.max(0, lineNumber - INCLUDE_LOOKBACK_LINES), lineNumber)
    .concat([lineUpToCursor]);
  const lookbackText = lookbackLines.join('\n');

  const tagSnippets = getTwigTagSnippets(lineUpToCursor, lineAfterCursor, lineNumber, enableGenericSnippets);
  if (tagSnippets.length > 0) return tagSnippets;

  const tagBodyMatch = TAG_BODY_PATTERN.exec(lookbackText);
  if (tagBodyMatch !== null) {
    const partialTyped = tagBodyMatch[1] ?? '';
    const wordStart = cursorChar - partialTyped.length;
    const replaceRange = Range.create(
      Position.create(lineNumber, wordStart),
      params.position,
    );
    // isIncomplete:true forces a re-query each keystroke so the client cache never hides this item.
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

  const wordSnippets = getTwigWordSnippets(lineUpToCursor, lineNumber, enableGenericSnippets);
  if (wordSnippets.length > 0) {
    return CompletionList.create(wordSnippets, true);
  }

  if (EARLY_SHORTHAND_PREFIX.test(lineUpToCursor)) {
    return CompletionList.create([], true);
  }

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
 * @param partialInput - Text already typed inside the string literal
 * @param params - LSP completion params
 * @param doc - The current text document
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns Component ID completion items
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
 * Derives the `@provider/relative/path.twig` namespace path for a component.
 *
 * @param provider - The component's provider name
 * @param twigFilePath - Absolute path to the component's twig file
 * @returns The namespace path, or null if `components/` is not in the path
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
 * @param partialInput - Text already typed (starts with `@`)
 * @param params - LSP completion params
 * @param doc - The current text document
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns Namespace path completion items
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
 * Builds completion items for the props and slots of an invoked component.
 *
 * Required props sort before optional ones, and already-used keys are excluded.
 *
 * @param ctx - The detected invocation context
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns Prop and slot completion items
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
 * Builds include snippets for components matching a bare-word query.
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

  const items: CompletionItem[] = [];

  for (const component of matches) {
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
 * Resolves a completion item by populating its documentation from `item.data`.
 *
 * @param item - The completion item to resolve
 * @param registry - SDC component registry
 * @returns The same item with documentation populated
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
