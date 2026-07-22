import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { SDCRegistry } from '@drupal-sdc-lsp/core';
import { SERVER_NAME } from './metadata.js';

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
<<<<<<< Updated upstream
 * Matches Twig comment blocks and verbatim blocks, whose contents Twig never
 * executes. Component references inside these ranges must not be diagnosed.
 *
 * Matches:
 *   {# {% include 'example:missing' %} #}
 *   {% verbatim %}{% include 'example:missing' %}{% endverbatim %}
 */
const INERT_BLOCK_PATTERN =
  /\{#[\s\S]*?#\}|\{%-?\s*verbatim\s*-?%\}[\s\S]*?\{%-?\s*endverbatim\s*-?%\}/gi;

type OffsetRange = readonly [start: number, end: number];

/** Byte-offset ranges of comment and verbatim blocks within the document text. */
function findInertRanges(text: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];

  INERT_BLOCK_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INERT_BLOCK_PATTERN.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }

  return ranges;
}

function isWithinAnyRange(offset: number, ranges: OffsetRange[]): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

/**
 * Scans a Twig document for SDC component references and returns a diagnostic
 * for every component ID that is not present in the registry.
=======
 * Returns a diagnostic for every referenced component ID absent from the registry.
>>>>>>> Stashed changes
 *
 * Call only after the registry is ready.
 *
 * @param document - The open text document to validate
 * @param registry - A fully built SDC registry
 * @returns LSP diagnostics, empty if all referenced components are known
 */
export function getDiagnostics(document: TextDocument, registry: SDCRegistry): Diagnostic[] {
  const text = document.getText();
  const diagnostics: Diagnostic[] = [];
  const inertRanges = findInertRanges(text);

  COMPONENT_REFERENCE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = COMPONENT_REFERENCE_PATTERN.exec(text)) !== null) {
    if (isWithinAnyRange(match.index, inertRanges)) {
      continue;
    }

    const componentId = match[1];

    if (registry.getById(componentId) !== undefined) {
      continue;
    }

    const idStart = match.index + match[0].indexOf(componentId);
    const idEnd = idStart + componentId.length;

    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: {
        start: document.positionAt(idStart),
        end: document.positionAt(idEnd),
      },
      message: `Unknown SDC component: "${componentId}"`,
      source: SERVER_NAME,
    });
  }

  return diagnostics;
}
