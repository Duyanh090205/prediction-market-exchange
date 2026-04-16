/**
 * Rate Limiter — In-Memory
 *
 * 10 failed login attempts per IP within a 15-minute window.
 * After 10 failures, the IP is blocked for 15 minutes.
 * Successful login resets the counter.
 *
 * Replace with Redis if scaling significantly.
 */

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  blockedUntil?: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check whether an IP is allowed to attempt login.
 * Must be called BEFORE bcrypt comparison.
 */
export function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
} {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry) {
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }

  // If blocked and block hasn't expired
  if (entry.blockedUntil && entry.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: entry.blockedUntil - now,
    };
  }

  // If window has expired, reset
  if (now - entry.firstAttempt > WINDOW_MS) {
    store.delete(ip);
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }

  // If at max attempts, block
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + WINDOW_MS;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: WINDOW_MS,
    };
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - entry.count };
}

/**
 * Record a failed login attempt for an IP.
 */
export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    store.set(ip, { count: 1, firstAttempt: now });
    return;
  }

  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + WINDOW_MS;
  }
}

/**
 * Reset rate limit for an IP after successful login.
 */
export function resetRateLimit(ip: string): void {
  store.delete(ip);
}
