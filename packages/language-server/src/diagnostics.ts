import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { SDCRegistry } from '@drupal-sdc-lsp/core';

/**
 * Matches SDC component IDs inside {% include %} and {% embed %} Twig tags.
 * Captures the `provider:component` ID only — `@namespace/path.twig` forms are ignored.
 *
 * Matches:
 *   {% include 'provider:component' %}
 *   {%- embed "provider:component" with { ... } %}
 *
 * Does NOT match:
 *   {% include '@provider/path.twig' %}
 *   arbitrary occurrences of colon-separated words
 */
const COMPONENT_REFERENCE_PATTERN =
  /\{%-?\s*(?:include|embed)\s+['"]([a-z0-9_][a-z0-9_-]*:[a-z0-9_][a-z0-9_-]*)['"]/gi;

/**
 * Scans a Twig document for SDC component references and returns a diagnostic
 * for every component ID that is not present in the registry.
 *
 * This function is synchronous and pure — call it only after the registry is ready.
 *
 * @param document - The open text document to validate
 * @param registry - A fully built SDC registry
 * @returns Array of LSP diagnostics (empty if all referenced components are known)
 */
export function getDiagnostics(document: TextDocument, registry: SDCRegistry): Diagnostic[] {
  const text = document.getText();
  const diagnostics: Diagnostic[] = [];

  COMPONENT_REFERENCE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = COMPONENT_REFERENCE_PATTERN.exec(text)) !== null) {
    const componentId = match[1];

    if (registry.getById(componentId) !== undefined) {
      continue;
    }

    // Offset of the component ID within the full document text
    const idStart = match.index + match[0].indexOf(componentId);
    const idEnd = idStart + componentId.length;

    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: {
        start: document.positionAt(idStart),
        end: document.positionAt(idEnd),
      },
      message: `Unknown SDC component: "${componentId}"`,
      source: 'drupal-sdc-lsp',
    });
  }

  return diagnostics;
}
