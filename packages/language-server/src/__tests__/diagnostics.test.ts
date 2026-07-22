import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver/node.js';
import { SDCRegistry, buildRegistry } from '@drupal-sdc-lsp/core';
import { getDiagnostics } from '../diagnostics.js';

const FIXTURES_DIR = path.resolve(__dirname, '../../../../fixtures/example');

function makeDoc(text: string): TextDocument {
  return TextDocument.create('file:///test.twig', 'twig', 1, text);
}

describe('getDiagnostics', () => {
  let registry: SDCRegistry;

  beforeAll(async () => {
    registry = await buildRegistry(FIXTURES_DIR);
  });

  it('returns empty array when document has no include or embed tags', () => {
    const doc = makeDoc('{% set foo = "bar" %}\n{{ foo }}');
    expect(getDiagnostics(doc, registry)).toEqual([]);
  });

  it('returns empty array when all component IDs are known', () => {
    const doc = makeDoc("{% include 'example:button' %}");
    expect(getDiagnostics(doc, registry)).toEqual([]);
  });

  it('returns empty array for known component in embed', () => {
    const doc = makeDoc("{% embed 'example:card' %}{% endembed %}");
    expect(getDiagnostics(doc, registry)).toEqual([]);
  });

  it('returns a warning for an unknown component ID in include', () => {
    const doc = makeDoc("{% include 'example:nonexistent' %}");
    const diags = getDiagnostics(doc, registry);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diags[0].message).toBe('Unknown SDC component: "example:nonexistent"');
    expect(diags[0].source).toBe('drupal-sdc-lsp');
  });

  it('returns a warning for an unknown component ID in embed', () => {
    const doc = makeDoc("{% embed 'example:missing' %}{% endembed %}");
    const diags = getDiagnostics(doc, registry);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('Unknown SDC component: "example:missing"');
  });

  it('returns one diagnostic per unknown ID across multiple lines', () => {
    const doc = makeDoc(
      "{% include 'example:button' %}\n" +
      "{% include 'example:ghost' %}\n" +
      "{% embed 'example:phantom' %}{% endembed %}\n",
    );
    const diags = getDiagnostics(doc, registry);
    expect(diags).toHaveLength(2);
    const messages = diags.map((d) => d.message);
    expect(messages).toContain('Unknown SDC component: "example:ghost"');
    expect(messages).toContain('Unknown SDC component: "example:phantom"');
  });

  it('highlights only the component ID in the range, not the whole tag', () => {
    //                  0123456789012345678901234567890
    const text = "{% include 'example:missing' %}";
    const doc = makeDoc(text);
    const diags = getDiagnostics(doc, registry);

    expect(diags).toHaveLength(1);
    const range = diags[0].range;

    // "example:missing" starts at index 12 (after {% include ')
    const expectedStart = text.indexOf('example:missing');
    expect(range.start.character).toBe(expectedStart);
    expect(range.end.character).toBe(expectedStart + 'example:missing'.length);
    expect(range.start.line).toBe(0);
  });

  it('reports the correct line for a diagnostic on a non-first line', () => {
    const doc = makeDoc("{% include 'example:button' %}\n{% include 'example:ghost' %}");
    const diags = getDiagnostics(doc, registry);
    expect(diags).toHaveLength(1);
    expect(diags[0].range.start.line).toBe(1);
  });

  it('ignores @namespace/path.twig style includes', () => {
    const doc = makeDoc("{% include '@example/atoms/button/button.twig' %}");
    expect(getDiagnostics(doc, registry)).toEqual([]);
  });

  it('works with double-quoted strings', () => {
    const doc = makeDoc('{% include "example:nonexistent" %}');
    const diags = getDiagnostics(doc, registry);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('Unknown SDC component: "example:nonexistent"');
  });

  it('works with the {%- trimmed tag variant', () => {
    const doc = makeDoc("{%- include 'example:nonexistent' %}");
    const diags = getDiagnostics(doc, registry);
    expect(diags).toHaveLength(1);
  });

  it('returns no diagnostics for an empty document', () => {
    expect(getDiagnostics(makeDoc(''), registry)).toEqual([]);
  });
});
