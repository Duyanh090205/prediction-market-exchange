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
  service: string;
  env: string;
  method: string;
  path: string;
  requestId?: string;
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
    service: process.env.SERVICE_NAME || "trading-game-platform",
    env: process.env.NODE_ENV || "development",
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
    service: process.env.SERVICE_NAME || "trading-game-platform",
    env: process.env.NODE_ENV || "development",
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
        requestId: request.headers.get("x-request-id") || undefined,
        userId,
        statusCode,
        processingTimeMs: Date.now() - start,
        ...extra,
      });
    },

    error(
      error: unknown,
      userId?: number | string,
      extra?: Record<string, unknown>
    ) {
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: "ERROR",
        service: process.env.SERVICE_NAME || "trading-game-platform",
        env: process.env.NODE_ENV || "development",
        method: request.method,
        path: url.pathname,
        requestId: request.headers.get("x-request-id") || undefined,
        userId,
        processingTimeMs: Date.now() - start,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        ...extra,
      };
      console.error(JSON.stringify(logEntry));
    },
  };
}

/**
 * Sanitize a request body for logging — drops sensitive fields and truncates
 * any string > 500 chars. Use when you need to record what payload caused
 * a 4xx/5xx without leaking passwords or PII.
 */
export function sanitizeBodyForLog(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const SENSITIVE = new Set([
    "password",
    "hashedPassword",
    "token",
    "tempPassword",
    "secret",
    "Idempotency-Key",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SENSITIVE.has(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 500) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}
