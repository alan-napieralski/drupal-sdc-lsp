import * as fs from 'fs';
import type { DefinitionParams, Location, TextDocuments } from 'vscode-languageserver/node.js';
import { Range } from 'vscode-languageserver/node.js'; // Range used for TOP_OF_FILE_RANGE
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import type { SDCRegistry } from '@drupal-sdc-lsp/core';
import type { Logger } from './logger.js';

/**
 * Pattern that matches a `provider:component` style ID token.
 * Allows letters, digits, underscores, and hyphens on both sides of the colon.
 */
const COMPONENT_ID_PATTERN = /[a-z0-9_][a-z0-9_-]*:[a-z0-9_][a-z0-9_-]*/g;

/** A zero-width range at the top of a file — sufficient for go-to-definition. */
const TOP_OF_FILE_RANGE = Range.create(0, 0, 0, 0);

/**
 * Resolves a go-to-definition request for a Drupal SDC component ID.
 *
 * Extracts the token under the cursor, looks it up in the registry, validates
 * the target file exists on disk, and returns an LSP `Location`.
 *
 * Returns `null` — never throws — when the token is not a known component ID,
 * when the target file does not exist, or on any error.
 *
 * @param params - LSP definition request parameters
 * @param documents - Open document store
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns A Location pointing to the component's twig or yaml file, or null
 */
export async function getDefinition(
  params: DefinitionParams,
  documents: TextDocuments<TextDocument>,
  registry: SDCRegistry,
  logger: Logger,
): Promise<Location | null> {
  const doc = documents.get(params.textDocument.uri);
  if (doc === undefined) {
    return null;
  }

  const lineText = doc.getText().split('\n')[params.position.line] ?? '';

  const componentId = extractComponentIdAtOffset(lineText, params.position.character);
  if (componentId === null) {
    return null;
  }

  await registry.readyPromise;

  const component = registry.getById(componentId);
  if (component === undefined) {
    logger.debug(`No component found for ID: ${componentId}`);
    return null;
  }

  // Prefer the .twig file; fall back to .component.yml
  const targetPath = component.twigFilePath ?? component.yamlFilePath;

  const fileExists = await checkFileExists(targetPath);
  if (!fileExists) {
    logger.warn(`Target file does not exist on disk: ${targetPath}`);
    return null;
  }

  return {
    uri: URI.file(targetPath).toString(),
    range: TOP_OF_FILE_RANGE,
  };
}

/**
 * Extracts a `provider:component` token from a line of text at a given character offset.
 *
 * @param lineText - Full text of the line
 * @param characterOffset - Zero-based cursor position within the line
 * @returns The matched component ID, or `null` if no token spans the cursor
 */
function extractComponentIdAtOffset(lineText: string, characterOffset: number): string | null {
  COMPONENT_ID_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = COMPONENT_ID_PATTERN.exec(lineText)) !== null) {
    const tokenStart = match.index;
    const tokenEnd = tokenStart + match[0].length;

    if (characterOffset >= tokenStart && characterOffset <= tokenEnd) {
      return match[0];
    }
  }

  return null;
}

/**
 * Checks whether a file exists on disk at the given path.
 *
 * @param filePath - Absolute filesystem path to check
 * @returns `true` if the file is accessible, `false` otherwise
 */
async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
