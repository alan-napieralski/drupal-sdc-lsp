import type { HoverParams, Hover, TextDocuments } from 'vscode-languageserver/node.js';
import { MarkupKind, Range, Position } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { SDCRegistry, ComponentMetadata } from '@drupal-sdc-lsp/core';
import { extractComponentIdTokenAtOffset } from './token-extractor.js';

/**
 * Returns hover documentation for the Drupal SDC component ID under the cursor.
 *
 * Shows the component name, description, a props table (with types and required
 * status), and a slots table. Returns `null` when the cursor is not over a
 * known component ID.
 *
 * The response is standard LSP `Hover` with `MarkupContent` markdown — rendered
 * automatically on mouse-over in VS Code and on demand (e.g. `K`) in Neovim.
 *
 * @param params - LSP hover request params
 * @param documents - Open document store
 * @param registry - SDC component registry
 * @returns Hover content with token range, or null
 */
export async function getHover(
  params: HoverParams,
  documents: TextDocuments<TextDocument>,
  registry: SDCRegistry,
): Promise<Hover | null> {
  const doc = documents.get(params.textDocument.uri);
  if (doc === undefined) return null;

  const lineText = doc.getText().split('\n')[params.position.line] ?? '';
  const token = extractComponentIdTokenAtOffset(lineText, params.position.character);
  if (token === null) return null;

  await registry.readyPromise;

  const component = registry.getById(token.id);
  if (component === undefined) return null;

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: buildHoverMarkdown(component),
    },
    range: Range.create(
      Position.create(params.position.line, token.start),
      Position.create(params.position.line, token.end),
    ),
  };
}

/**
 * Builds the markdown string for hover documentation from component metadata.
 */
function buildHoverMarkdown(component: ComponentMetadata): string {
  const lines: string[] = [`### ${component.name}`];

  if (component.description !== undefined) {
    lines.push('', component.description);
  }

  if (component.props.length > 0) {
    lines.push('', '**Props**');
    lines.push('| Name | Type | Required | Description |');
    lines.push('|------|------|:--------:|-------------|');

    for (const prop of component.props) {
      const required = prop.required ? '✓' : '';
      const descParts: string[] = [];
      if (prop.description !== undefined) descParts.push(prop.description);
      if (prop.default !== undefined) descParts.push(`*(default: \`${String(prop.default)}\`)*`);
      const desc = descParts.join(' ');
      lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${required} | ${desc} |`);
    }
  }

  if (component.slots.length > 0) {
    lines.push('', '**Slots**');
    lines.push('| Name | Description |');
    lines.push('|------|-------------|');

    for (const slot of component.slots) {
      lines.push(`| \`${slot.name}\` | ${slot.description ?? ''} |`);
    }
  }

  return lines.join('\n');
}
