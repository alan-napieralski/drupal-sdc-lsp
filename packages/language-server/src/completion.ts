import {
  CompletionItem,
  CompletionItemKind,
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
 * Returns completion items for the current cursor position in a Twig document.
 *
 * Awaits `registry.readyPromise` to avoid empty results during startup indexing.
 * Checks for document staleness and cancellation after each async boundary.
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
  if (doc === undefined) {
    return [];
  }

  const versionAtRequestTime = doc.version;

  await registry.readyPromise;

  if (token.isCancellationRequested) {
    return [];
  }

  const currentDoc = documents.get(params.textDocument.uri);
  if (currentDoc?.version !== versionAtRequestTime) {
    return [];
  }

  const line = currentDoc.getText(
    Range.create(
      Position.create(params.position.line, 0),
      params.position,
    ),
  );

  if (line.length > MAX_LINE_LENGTH) {
    logger.debug(`Line too long for completion (${line.length} chars), skipping`);
    return [];
  }

  if (COMMENT_LINE_PATTERN.test(line)) {
    return [];
  }

  const contextMatch = INCLUDE_CONTEXT_PATTERN.exec(line);
  if (contextMatch === null) {
    return [];
  }

  const partialInput = contextMatch[1];

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

  // Find the start of the partial input in the line to set the replace range
  const lineStart = Position.create(params.position.line, 0);
  const lineText = doc.getText(Range.create(lineStart, params.position));
  const partialStart = lineText.length - partialInput.length;

  const replaceRange = Range.create(
    Position.create(params.position.line, partialStart),
    params.position,
  );

  return allComponents.map((component) => {
    const item: CompletionItem = {
      label: component.id,
      kind: CompletionItemKind.Module,
      detail: component.name,
      // Store only the ID — full docs deferred to resolveCompletion
      data: component.id,
      textEdit: TextEdit.replace(replaceRange, component.id),
    };

    return item;
  });
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
  if (componentId === null) {
    return item;
  }

  const component = registry.getById(componentId);
  if (component === undefined) {
    return item;
  }

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
