import {
  DidChangeWatchedFilesNotification,
  FileChangeType,
  type Connection,
} from 'vscode-languageserver/node.js';
import { URI } from 'vscode-uri';
import type { SDCRegistry } from '@drupal-sdc-lsp/core';
import type { Logger } from './logger.js';

const DEBOUNCE_MS = 300;
const BULK_DEBOUNCE_MS = 500;
const BULK_EVENT_THRESHOLD = 10;

/**
 * Sets up the file watcher that keeps the SDC registry current as `.component.yml`
 * files are created, modified, or deleted during an editing session.
 *
 * Uses `workspace/didChangeWatchedFiles` dynamic registration to delegate watching
 * to the editor client, which handles platform-specific file watching reliably.
 *
 * @param connection - Active LSP connection
 * @param registry - SDC component registry to update
 * @param workspaceRoot - Root directory of the workspace (used for bulk rebuilds)
 * @param logger - Structured logger
 * @returns A dispose function that clears all timers on shutdown
 */
export function setupWatcher(
  connection: Connection,
  registry: SDCRegistry,
  workspaceRoot: string,
  logger: Logger,
): () => void {
  const perFileTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let bulkTimer: ReturnType<typeof setTimeout> | null = null;
  let recentEventCount = 0;
  let recentEventWindowTimer: ReturnType<typeof setTimeout> | null = null;

  // Register with the client to watch all .component.yml files
  connection.client
    .register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: '**/*.component.yml' }],
    })
    .catch((err: unknown) => {
      logger.warn(`Could not register file watcher: ${String(err)}`);
    });

  connection.onDidChangeWatchedFiles((params) => {
    const changes = params.changes;

    recentEventCount += changes.length;

    // Reset the event-count window after 300ms of quiet
    if (recentEventWindowTimer !== null) {
      clearTimeout(recentEventWindowTimer);
    }
    recentEventWindowTimer = setTimeout(() => {
      recentEventCount = 0;
      recentEventWindowTimer = null;
    }, DEBOUNCE_MS);

    // Bulk protection: many simultaneous changes trigger a single full rebuild
    if (recentEventCount > BULK_EVENT_THRESHOLD) {
      logger.info(
        `Bulk file event threshold exceeded (${recentEventCount} events). ` +
        `Triggering full registry rebuild after ${BULK_DEBOUNCE_MS}ms.`,
      );

      for (const timer of perFileTimers.values()) {
        clearTimeout(timer);
      }
      perFileTimers.clear();

      if (bulkTimer !== null) {
        clearTimeout(bulkTimer);
      }

      bulkTimer = setTimeout(() => {
        bulkTimer = null;
        recentEventCount = 0;
        registry.rebuild(workspaceRoot).catch((err: unknown) => {
          logger.error(`Registry rebuild failed: ${String(err)}`);
        });
      }, BULK_DEBOUNCE_MS);

      return;
    }

    // Per-file debounced updates
    for (const change of changes) {
      const filePath = URI.parse(change.uri).fsPath;
      const existingTimer = perFileTimers.get(filePath);

      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        perFileTimers.delete(filePath);

        if (change.type === FileChangeType.Deleted) {
          registry.removeComponent(filePath);
          logger.debug(`Removed component: ${filePath}`);
        } else {
          // Created or Changed — re-parse and update
          registry.updateComponent(filePath).catch((err: unknown) => {
            logger.error(`Failed to update component ${filePath}: ${String(err)}`);
          });
          logger.debug(`Updated component: ${filePath}`);
        }
      }, DEBOUNCE_MS);

      perFileTimers.set(filePath, timer);
    }
  });

  // Return dispose function to clean up timers on shutdown
  return function dispose(): void {
    for (const timer of perFileTimers.values()) {
      clearTimeout(timer);
    }
    perFileTimers.clear();

    if (bulkTimer !== null) {
      clearTimeout(bulkTimer);
      bulkTimer = null;
    }

    if (recentEventWindowTimer !== null) {
      clearTimeout(recentEventWindowTimer);
      recentEventWindowTimer = null;
    }
  };
}
