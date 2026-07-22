import * as fs from 'fs';
import type { DefinitionParams, Location, TextDocuments } from 'vscode-languageserver/node.js';
import { Range } from 'vscode-languageserver/node.js'; // Range used for TOP_OF_FILE_RANGE
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import type { SDCRegistry } from '@drupal-sdc-lsp/core';
import type { Logger } from './logger.js';
import {
  extractComponentIdTokenAtOffset,
  extractNamespacePathTokenAtOffset,
} from './token-extractor.js';

/** A zero-width range at the top of a file — sufficient for go-to-definition. */
const TOP_OF_FILE_RANGE = Range.create(0, 0, 0, 0);

/**
 * Resolves a go-to-definition request for a Drupal SDC component reference.
 *
 * Handles both `provider:component` IDs and `@provider/path.twig` namespace
 * paths under the cursor, looks the reference up in the registry, validates the
 * target file exists on disk, and returns an LSP `Location`.
 *
 * Returns `null` — never throws — when the token is not a known reference,
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
  const cursor = params.position.character;

  await registry.readyPromise;

  const targetPath = resolveTargetPath(lineText, cursor, registry, logger);
  if (targetPath === null) {
    return null;
  }

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
 * Resolves the definition target file for whichever reference token spans the
 * cursor — a `provider:component` ID or a `@provider/path.twig` namespace path.
 *
 * @param lineText - The full text of the line under the cursor
 * @param cursor - Zero-based cursor character offset within the line
 * @param registry - SDC component registry
 * @param logger - Structured logger
 * @returns Absolute path to the target file, or null if nothing resolves
 */
function resolveTargetPath(
  lineText: string,
  cursor: number,
  registry: SDCRegistry,
  logger: Logger,
): string | null {
  const idToken = extractComponentIdTokenAtOffset(lineText, cursor);
  if (idToken !== null) {
    const component = registry.getById(idToken.id);
    if (component === undefined) {
      logger.debug(`No component found for ID: ${idToken.id}`);
      return null;
    }
    return component.twigFilePath ?? component.yamlFilePath;
  }

  const pathToken = extractNamespacePathTokenAtOffset(lineText, cursor);
  if (pathToken === null) {
    return null;
  }

  const component = registry.getByNamespacePath(pathToken.id);
  if (component !== undefined) {
    return component.twigFilePath ?? component.yamlFilePath;
  }

  const twigEntry = registry.getTwigEntryByNamespacePath(pathToken.id);
  if (twigEntry !== undefined) {
    return twigEntry.absolutePath;
  }

  logger.debug(`No component or template found for namespace path: ${pathToken.id}`);
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
