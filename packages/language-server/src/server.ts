// Safety: redirect console.log to stderr to protect the LSP protocol stream
console.log = (...args: unknown[]) => console.error('[LOG]', ...args);

import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  MessageType,
  PositionEncodingKind,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { SDCRegistry } from '@drupal-sdc-lsp/core';
import { createLogger } from './logger.js';
import { getCompletions, resolveCompletion } from './completion.js';
import { getDefinition } from './definition.js';
import { getHover } from './hover.js';
import { setupWatcher } from './watcher.js';

// Validate CLI arguments — only --stdio is accepted
const knownFlags = new Set(['--stdio']);
const unknownFlags = process.argv.slice(2).filter((arg) => !knownFlags.has(arg));
if (unknownFlags.length > 0) {
  process.stderr.write(`[error] Unknown flag(s): ${unknownFlags.join(', ')}. Only --stdio is supported.\n`);
  process.exit(1);
}

// Guard against unhandled promise rejections crashing the server
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[error] Unhandled rejection: ${String(reason)}\n`);
});

// Guard against uncaught exceptions — log and exit cleanly for supervisor restart
process.on('uncaughtException', (err) => {
  process.stderr.write(`[error] Uncaught exception: ${String(err)}\n`);
  process.exit(1);
});

// Bootstrap LSP connection before any other stdout activity
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments<TextDocument>(TextDocument);

const logger = createLogger(connection.console, 'info');
const registry = new SDCRegistry();

let workspaceRoot: string | null = null;
let disposeWatcher: (() => void) | null = null;

connection.onInitialize((params) => {
  // Resolve workspace root from workspaceFolders or rootUri (never rootPath)
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    const firstFolder = params.workspaceFolders[0];
    workspaceRoot = URI.parse(firstFolder.uri).fsPath;

    if (params.workspaceFolders.length > 1) {
      process.stderr.write(
        '[info] Multi-root workspace detected. Indexing first folder only for MVP.\n',
      );
    }
  } else if (params.rootUri != null) {
    workspaceRoot = URI.parse(params.rootUri).fsPath;
  }

  // Return capabilities immediately — do NOT await registry build
  return {
    capabilities: {
      positionEncoding: PositionEncodingKind.UTF16,
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ["'", '"', ':', '@', '/'],
        resolveProvider: true,
      },
      definitionProvider: true,
      hoverProvider: true,
    },
  };
});

connection.onInitialized(() => {
  if (workspaceRoot === null) {
    logger.warn('No workspace root found. Running with empty registry.');
    connection.window
      .showMessage({
        type: MessageType.Warning,
        message:
          'drupal-sdc-lsp: Could not determine workspace root. ' +
          'Component completions will not be available.',
      })
      .catch(() => {
        // Ignore if window/showMessage is not supported
      });

    registry.build('').catch((err: unknown) => {
      logger.error(`Registry build failed: ${String(err)}`);
    });
    return;
  }

  // Start async indexing — does not block the initialized response
  registry.build(workspaceRoot).catch((err: unknown) => {
    logger.error(`Registry build failed: ${String(err)}`);
  });

  // Start file watcher for incremental re-indexing
  disposeWatcher = setupWatcher(connection, registry, workspaceRoot, logger);

  logger.info(`drupal-sdc-lsp initialized. Indexing: ${workspaceRoot}`);
});

connection.onCompletion(async (params, token) => {
  try {
    return await getCompletions(params, documents, registry, logger, token);
  } catch (err) {
    logger.error(`Completion handler error: ${String(err)}`);
    return [];
  }
});

connection.onCompletionResolve((item) => {
  try {
    return resolveCompletion(item, registry);
  } catch (err) {
    logger.error(`CompletionResolve handler error: ${String(err)}`);
    return item;
  }
});

connection.onDefinition(async (params) => {
  try {
    return await getDefinition(params, documents, registry, logger);
  } catch (err) {
    logger.error(`Definition handler error: ${String(err)}`);
    return null;
  }
});

connection.onHover(async (params) => {
  try {
    return await getHover(params, documents, registry);
  } catch (err) {
    logger.error(`Hover handler error: ${String(err)}`);
    return null;
  }
});

connection.onShutdown(() => {
  logger.info('Server shutting down.');
  if (disposeWatcher !== null) {
    disposeWatcher();
    disposeWatcher = null;
  }
});

connection.onExit(() => {
  process.exit(0);
});

documents.listen(connection);
connection.listen();
