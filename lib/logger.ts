/**
 * Structured Logger
 *
 * Every Route Handler logs: method, path, userId, statusCode, processingTime (ms)
 * High-stakes actions: also log tradeId/contractId and outcome
 * Errors: full stack trace, not just message
 *
 * Output: console (piped to Digital Ocean App Platform Runtime Logs in production)
 */

interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  method: string;
  path: string;
  userId?: number | string;
  statusCode?: number;
  processingTimeMs?: number;
  tradeId?: number;
  contractId?: number;
  outcome?: string;
  error?: {
    message: string;
    stack?: string;
  };
  [key: string]: unknown;
}

/**
 * Log a structured entry at INFO level.
 */
export function log(
  entry: Omit<LogEntry, "timestamp" | "level"> & {
    method: string;
    path: string;
    statusCode: number;
  }
): void {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: "INFO",
    ...entry,
  };
  console.log(JSON.stringify(logEntry));
}

/**
 * Log an error with full stack trace.
 */
export function logError(
  method: string,
  path: string,
  error: unknown,
  userId?: number | string
): void {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: "ERROR",
    method,
    path,
    userId,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  };
  console.error(JSON.stringify(logEntry));
}

/**
 * Create a request-scoped logger that automatically tracks processing time.
 *
 * Usage:
 *   const reqLog = createRequestLogger(request);
 *   // ... process request ...
 *   reqLog.finish(200, userId, { tradeId: 42, outcome: "confirmed" });
 */
export function createRequestLogger(request: Request) {
  const start = Date.now();
  const url = new URL(request.url);

  return {
    finish(
      statusCode: number,
      userId?: number | string,
      extra?: Record<string, unknown>
    ) {
      log({
        method: request.method,
        path: url.pathname,
        userId,
        statusCode,
        processingTimeMs: Date.now() - start,
        ...extra,
      });
    },

    error(error: unknown, userId?: number | string) {
      logError(request.method, url.pathname, error, userId);
    },
  };
}
