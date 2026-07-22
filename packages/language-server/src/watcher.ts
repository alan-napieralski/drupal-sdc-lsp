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
 * Sets up the watcher that keeps the registry current as `.component.yml` files change.
 *
 * @param connection - Active LSP connection
 * @param registry - SDC component registry to update
 * @param workspaceRoot - Root directory of the workspace, used for bulk rebuilds
 * @param logger - Structured logger
 * @param onRegistryChange - Optional callback invoked after each registry mutation
 * @returns A dispose function that clears all timers on shutdown
 */
export function setupWatcher(
  connection: Connection,
  registry: SDCRegistry,
  workspaceRoot: string,
  logger: Logger,
  onRegistryChange?: () => void,
): () => void {
  const perFileTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let bulkTimer: ReturnType<typeof setTimeout> | null = null;
  let recentEventCount = 0;
  let recentEventWindowTimer: ReturnType<typeof setTimeout> | null = null;

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

    if (recentEventWindowTimer !== null) {
      clearTimeout(recentEventWindowTimer);
    }
    recentEventWindowTimer = setTimeout(() => {
      recentEventCount = 0;
      recentEventWindowTimer = null;
    }, DEBOUNCE_MS);

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
        registry.rebuild(workspaceRoot).then(() => {
          onRegistryChange?.();
        }).catch((err: unknown) => {
          logger.error(`Registry rebuild failed: ${String(err)}`);
        });
      }, BULK_DEBOUNCE_MS);

      return;
    }

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
          onRegistryChange?.();
        } else {
          registry.updateComponent(filePath).then(() => {
            onRegistryChange?.();
          }).catch((err: unknown) => {
            logger.error(`Failed to update component ${filePath}: ${String(err)}`);
          });
          logger.debug(`Updated component: ${filePath}`);
        }
      }, DEBOUNCE_MS);

      perFileTimers.set(filePath, timer);
    }
  });

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
