import type { RemoteConsole } from 'vscode-languageserver/node.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured logger that delegates to the LSP connection's remote console
 * with configurable minimum log level.
 */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Creates a logger that wraps `connection.console` and filters messages
 * below the specified minimum level.
 *
 * @param console - The LSP remote console from `connection.console`
* @param level - Minimum level to emit (default: `"info"`)
 * @returns A structured Logger instance
 */
export function createLogger(console: RemoteConsole, level: LogLevel = 'info'): Logger {
  const minRank = LOG_LEVEL_RANK[level];

  const shouldLog = (msgLevel: LogLevel): boolean =>
    LOG_LEVEL_RANK[msgLevel] >= minRank;

  return {
    debug(message: string): void {
      if (shouldLog('debug')) {
        console.log(`[debug] ${message}`);
      }
    },

    info(message: string): void {
      if (shouldLog('info')) {
        console.info(`[info] ${message}`);
      }
    },

    warn(message: string): void {
      if (shouldLog('warn')) {
        console.warn(`[warn] ${message}`);
      }
    },

    error(message: string): void {
      if (shouldLog('error')) {
        console.error(`[error] ${message}`);
      }
    },
  };
}
