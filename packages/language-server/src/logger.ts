import type { RemoteConsole } from 'vscode-languageserver/node.js';

/** Severity levels a logger can emit, in ascending order. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Structured logger with a configurable minimum log level. */
export interface Logger {
  /** Logs a message at debug level. */
  debug(message: string): void;
  /** Logs a message at info level. */
  info(message: string): void;
  /** Logs a message at warning level. */
  warn(message: string): void;
  /** Logs a message at error level. */
  error(message: string): void;
}

/**
 * Creates a logger that wraps the remote console and filters by level.
 *
 * @param console - The LSP remote console from `connection.console`
 * @param level - Minimum level to emit (default: `info`)
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
