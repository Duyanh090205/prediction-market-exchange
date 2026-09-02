/**
 * Rate limiter — sliding window with pluggable backend.
 *
 * Defaults to an in-memory store (single-instance dev). When `REDIS_URL`
 * is set, transparently switches to a Redis-backed store using INCR + EXPIRE
 * with atomic Lua so multi-pod deployments share state.
 *
 * Identifier strategy: callers should compose IP + scope (e.g. `login:1.2.3.4`,
 * `register:1.2.3.4`, `order:user:42`). This module is scope-agnostic.
 */

interface RateLimitStore {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  recordFailure(key: string, windowMs: number): Promise<void>;
  reset(key: string): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

// ─── In-memory store (dev / single-pod) ──────────────────────────────────────

interface Entry {
  count: number;
  firstAttempt: number;
  blockedUntil?: number;
}

class InMemoryStore implements RateLimitStore {
  private store = new Map<string, Entry>();

  async check(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry) return { allowed: true, remaining: limit };

    if (entry.blockedUntil && entry.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: entry.blockedUntil - now,
      };
    }

    if (now - entry.firstAttempt > windowMs) {
      this.store.delete(key);
      return { allowed: true, remaining: limit };
    }

    if (entry.count >= limit) {
      entry.blockedUntil = now + windowMs;
      return { allowed: false, remaining: 0, retryAfterMs: windowMs };
    }

    return { allowed: true, remaining: limit - entry.count };
  }

  async recordFailure(key: string, windowMs: number): Promise<void> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now - entry.firstAttempt > windowMs) {
      this.store.set(key, { count: 1, firstAttempt: now });
      return;
    }

    entry.count++;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ─── Redis store (multi-pod prod) ────────────────────────────────────────────
//
// Lazy-loaded: only attempts to import ioredis when REDIS_URL is set, so dev
// installs don't need the dependency. In production add `ioredis` to deps.

class RedisStore implements RateLimitStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private clientPromise: Promise<any> | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod = await import(
          /* webpackIgnore: true */ "ioredis" as string
        ).catch((err) => {
          throw new Error(
            `REDIS_URL is set but ioredis is not installed: ${err.message}`
          );
        });
        const Redis = mod.default ?? mod;
        return new Redis(process.env.REDIS_URL!, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });
      })();
    }
    return this.clientPromise;
  }

  async check(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const client = await this.getClient();
    const blocked = await client.get(`rl:block:${key}`);
    if (blocked) {
      const ttl = await client.pttl(`rl:block:${key}`);
      return { allowed: false, remaining: 0, retryAfterMs: ttl > 0 ? ttl : windowMs };
    }
    const count = parseInt((await client.get(`rl:cnt:${key}`)) ?? "0", 10);
    if (count >= limit) {
      await client.set(`rl:block:${key}`, "1", "PX", windowMs);
      return { allowed: false, remaining: 0, retryAfterMs: windowMs };
    }
    return { allowed: true, remaining: limit - count };
  }

  async recordFailure(key: string, windowMs: number): Promise<void> {
    const client = await this.getClient();
    const k = `rl:cnt:${key}`;
    const count = await client.incr(k);
    if (count === 1) {
      await client.pexpire(k, windowMs);
    }
  }

  async reset(key: string): Promise<void> {
    const client = await this.getClient();
    await client.del(`rl:cnt:${key}`, `rl:block:${key}`);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const store: RateLimitStore = process.env.REDIS_URL
  ? new RedisStore()
  : new InMemoryStore();

// ─── Public API ──────────────────────────────────────────────────────────────

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

export async function checkLoginRateLimit(ip: string): Promise<RateLimitResult> {
  return store.check(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
}

export async function recordLoginFailure(ip: string, email?: string): Promise<void> {
  await store.recordFailure(`login:${ip}`, LOGIN_WINDOW_MS);
  if (email) {
    // structured failure log so admins can correlate IP-share collisions
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "WARN",
        event: "auth:login_failure",
        ip,
        email,
      })
    );
  }
}

export async function resetLoginRateLimit(ip: string): Promise<void> {
  await store.reset(`login:${ip}`);
}

export async function checkRegisterRateLimit(ip: string): Promise<RateLimitResult> {
  return store.check(`register:${ip}`, REGISTER_LIMIT, REGISTER_WINDOW_MS);
}

export async function recordRegisterAttempt(ip: string): Promise<void> {
  await store.recordFailure(`register:${ip}`, REGISTER_WINDOW_MS);
}

// ─── Programmatic API (/api/v1) — per-key sliding window ──────────────────────
//
// Keyed by ApiKey id so each bot key has its own budget (one user's runaway bot
// can't starve another's). 240 requests / minute is generous for a friends'
// game while still capping abuse; tune as needed.

const API_LIMIT = 240;
const API_WINDOW_MS = 60 * 1000;

export async function checkApiRateLimit(identifier: string): Promise<RateLimitResult> {
  return store.check(`api:${identifier}`, API_LIMIT, API_WINDOW_MS);
}

export async function recordApiRequest(identifier: string): Promise<void> {
  await store.recordFailure(`api:${identifier}`, API_WINDOW_MS);
}

// ─── Demo sandbox accounts — per IP, unauthenticated endpoint ────────────────
//
// POST /api/demo/session creates an account with no credentials presented, so
// it is the one write surface on this deployment a stranger can reach. Three
// per hour is enough for a reviewer who signs out and comes back; it is not
// enough to fill the table. lib/demoAccounts.ts caps and expires them as well.

const DEMO_LIMIT = 3;
const DEMO_WINDOW_MS = 60 * 60 * 1000;

export async function checkDemoSessionRateLimit(ip: string): Promise<RateLimitResult> {
  return store.check(`demo:${ip}`, DEMO_LIMIT, DEMO_WINDOW_MS);
}

export async function recordDemoSessionAttempt(ip: string): Promise<void> {
  await store.recordFailure(`demo:${ip}`, DEMO_WINDOW_MS);
}

// ─── Demo order flow — tighter than a real account ───────────────────────────
//
// Ordinary accounts belong to people the operator invited and are not rate
// limited on /api/orders beyond the idempotency key. A demo account is handed
// out to anyone with the link, so it gets a ceiling.

const DEMO_ORDER_LIMIT = 30;
const DEMO_ORDER_WINDOW_MS = 60 * 1000;

export async function checkDemoOrderRateLimit(
  userId: string | number
): Promise<RateLimitResult> {
  return store.check(`demoorder:${userId}`, DEMO_ORDER_LIMIT, DEMO_ORDER_WINDOW_MS);
}

export async function recordDemoOrder(userId: string | number): Promise<void> {
  await store.recordFailure(`demoorder:${userId}`, DEMO_ORDER_WINDOW_MS);
}

// ─── API-key creation — per user, so a logged-in account can't spam keys ──────

const KEY_CREATE_LIMIT = 20;
const KEY_CREATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function checkKeyCreateRateLimit(
  userId: string | number
): Promise<RateLimitResult> {
  return store.check(`keycreate:${userId}`, KEY_CREATE_LIMIT, KEY_CREATE_WINDOW_MS);
}

export async function recordKeyCreateAttempt(userId: string | number): Promise<void> {
  await store.recordFailure(`keycreate:${userId}`, KEY_CREATE_WINDOW_MS);
}

// Back-compat shims (used by auth.ts) — typed without IP details so we
// don't leak details into NextAuth's narrow contract.
export const checkRateLimit = checkLoginRateLimit;
export const recordFailedAttempt = recordLoginFailure;
export const resetRateLimit = resetLoginRateLimit;
