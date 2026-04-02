import type { HoverParams, Hover, TextDocuments } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { SDCRegistry } from '@drupal-sdc-lsp/core';

/**
 * Phase 2: Hover documentation. Returns null (stub) in Phase 1.
 *
 * @param params - LSP hover request params
 * @param documents - Open document store
 * @param registry - SDC component registry
 * @returns Hover content or null
 */
export async function getHover(
  params: HoverParams,
  documents: TextDocuments<TextDocument>,
  registry: SDCRegistry,
): Promise<Hover | null> {
  void params;
  void documents;
  void registry;
  return null;
}
