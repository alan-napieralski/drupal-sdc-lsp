import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import type { HoverParams, TextDocuments } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { SDCRegistry, buildRegistry } from '@drupal-sdc-lsp/core';
import { getHover } from '../hover.js';

const FIXTURES_DIR = path.resolve(__dirname, '../../../../fixtures/example');

/**
 * Creates a minimal TextDocuments mock that returns a fake document for one URI.
 */
function makeDocuments(uri: string, text: string): TextDocuments<TextDocument> {
  const fakeDoc = {
    getText: () => text,
    uri,
  } as unknown as TextDocument;

  return {
    get: (u: string) => (u === uri ? fakeDoc : undefined),
  } as unknown as TextDocuments<TextDocument>;
}

function makeParams(uri: string, line: number, character: number): HoverParams {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

describe('getHover', () => {
  let registry: SDCRegistry;

  beforeAll(async () => {
    registry = await buildRegistry(FIXTURES_DIR);
  });

  it('returns null when document is not open', async () => {
    const documents = makeDocuments('file:///other.twig', '');
    const params = makeParams('file:///missing.twig', 0, 10);
    const result = await getHover(params, documents, registry);
    expect(result).toBeNull();
  });

  it('returns null when cursor is not on a component ID', async () => {
    const uri = 'file:///test.twig';
    const text = "{% set foo = 'bar' %}";
    const documents = makeDocuments(uri, text);
    const params = makeParams(uri, 0, 8);
    const result = await getHover(params, documents, registry);
    expect(result).toBeNull();
  });

  it('returns null for an unknown component ID', async () => {
    const uri = 'file:///test.twig';
    const text = "{% include 'example:nonexistent' %}";
    const documents = makeDocuments(uri, text);
    const params = makeParams(uri, 0, 15);
    const result = await getHover(params, documents, registry);
    expect(result).toBeNull();
  });

  it('returns hover content for a known component ID', async () => {
    const uri = 'file:///test.twig';
    const text = "{% include 'example:card' %}";
    const documents = makeDocuments(uri, text);
    // Position 15 is inside 'example:card'
    const params = makeParams(uri, 0, 15);
    const result = await getHover(params, documents, registry);

    expect(result).not.toBeNull();
    expect(result!.contents).toBeDefined();
    const contents = result!.contents as { kind: string; value: string };
    expect(contents.kind).toBe('markdown');
    expect(contents.value).toContain('Card');
  });

  it('includes props table in hover markdown', async () => {
    const uri = 'file:///test.twig';
    const text = "{% include 'example:card' %}";
    const documents = makeDocuments(uri, text);
    const params = makeParams(uri, 0, 15);
    const result = await getHover(params, documents, registry);

    expect(result).not.toBeNull();
    const value = (result!.contents as { value: string }).value;
    expect(value).toContain('**Props**');
    expect(value).toContain('`title`');
    expect(value).toContain('`url`');
  });

  it('marks required props with a checkmark', async () => {
    const uri = 'file:///test.twig';
    const text = "{% include 'example:card' %}";
    const documents = makeDocuments(uri, text);
    const params = makeParams(uri, 0, 15);
    const result = await getHover(params, documents, registry);

    expect(result).not.toBeNull();
    const value = (result!.contents as { value: string }).value;
    // 'title' is required in example:card
    expect(value).toContain('✓');
  });

  it('includes slots table when component has slots', async () => {
    const uri = 'file:///test.twig';
    const text = "{% include 'example:card' %}";
    const documents = makeDocuments(uri, text);
    const params = makeParams(uri, 0, 15);
    const result = await getHover(params, documents, registry);

    expect(result).not.toBeNull();
    const value = (result!.contents as { value: string }).value;
    expect(value).toContain('**Slots**');
    expect(value).toContain('`body`');
  });

  it('returns a range spanning the component ID token', async () => {
    const uri = 'file:///test.twig';
    const text = "{% include 'example:card' %}";
    const documents = makeDocuments(uri, text);
    const params = makeParams(uri, 0, 15);
    const result = await getHover(params, documents, registry);

    expect(result).not.toBeNull();
    expect(result!.range).toBeDefined();
    // 'example:card' starts at char 12 and ends at char 24 in the line
    expect(result!.range!.start.character).toBe(12);
    expect(result!.range!.end.character).toBe(24);
  });
});
