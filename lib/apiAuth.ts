/**
 * Bearer-token resolver for the programmatic /api/v1 namespace.
 *
 * This is the API analog of lib/labAuth.ts's getLabUser: instead of a browser
 * `lab_session` cookie, a bot presents `Authorization: Bearer tgk_...`. We look
 * the key up by its prefix, verify the secret hash, and return the owning User.
 *
 * Key model (decided design — see project memory "Build the bot API key system"):
 *   - Format: `tgk_<43-char url-safe base64>` (32 bytes of entropy).
 *   - We store ONLY a SHA-256 hash of the full key (high-entropy → a fast hash is
 *     fine; bcrypt is for low-entropy passwords). The plaintext is shown once on
 *     creation and never persisted.
 *   - `keyPrefix` = the first 12 chars of the full key (`tgk_` + 8 random). It is
 *     unique, shown in the UI to identify a key, and the O(1) lookup handle.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "./prisma";

export const API_KEY_PREFIX = "tgk_";
/** How many leading chars of the full key we persist as the public prefix. */
const KEY_PREFIX_LEN = 12;
/** Only bump lastUsedAt at most once per this window, to avoid a write per call. */
const LAST_USED_THROTTLE_MS = 60_000;

// ─── Scopes ──────────────────────────────────────────────────────────────────

export const SCOPE_READ = "read";
export const SCOPE_TRADE = "trade";
/** Scopes a new key may request. */
export const ALL_SCOPES = [SCOPE_READ, SCOPE_TRADE] as const;
export type Scope = (typeof ALL_SCOPES)[number];

export function isValidScope(s: unknown): s is Scope {
  return typeof s === "string" && (ALL_SCOPES as readonly string[]).includes(s);
}

// ─── Key generation / hashing ────────────────────────────────────────────────

export interface GeneratedApiKey {
  /** The plaintext key — returned to the caller ONCE, never stored. */
  fullKey: string;
  /** Public, unique handle (first 12 chars) — stored + shown in the UI. */
  keyPrefix: string;
  /** SHA-256(fullKey) hex — the only secret material we persist. */
  hashedSecret: string;
}

export function hashApiKey(fullKey: string): string {
  return createHash("sha256").update(fullKey).digest("hex");
}

/** Mint a fresh API key. The plaintext lives only in the returned object. */
export function generateApiKey(): GeneratedApiKey {
  // 32 bytes → 43 url-safe base64 chars (no padding).
  const secret = randomBytes(32).toString("base64url");
  const fullKey = `${API_KEY_PREFIX}${secret}`;
  return {
    fullKey,
    keyPrefix: fullKey.slice(0, KEY_PREFIX_LEN),
    hashedSecret: hashApiKey(fullKey),
  };
}

// ─── Request authentication ──────────────────────────────────────────────────

export interface ApiUser {
  /** Trading-DB row id as a string (mirrors LabUser.id). */
  id: string;
  email: string;
  username: string;
  /** "ADMIN" | "LIQUIDITY_PROVIDER" | "USER" */
  role: string;
  /** Scopes granted to the presented key, e.g. ["read","trade"]. */
  scopes: string[];
  /** The ApiKey row id that authenticated this request (for rate-limit keying). */
  apiKeyId: number;
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
  const token = value.trim();
  return token.startsWith(API_KEY_PREFIX) ? token : null;
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Resolve the User behind a Bearer API key, or null if the request is not
 * authenticated. Returns null (caller → 401) when: no/invalid bearer, unknown
 * prefix, hash mismatch, key revoked, or the owner is not ACTIVE.
 */
export async function getApiUser(request: Request): Promise<ApiUser | null> {
  const fullKey = extractBearer(request);
  if (!fullKey) return null;

  const keyPrefix = fullKey.slice(0, KEY_PREFIX_LEN);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyPrefix },
    include: {
      user: { select: { id: true, email: true, username: true, role: true, status: true } },
    },
  });
  if (!apiKey) return null;
  if (apiKey.revokedAt) return null;

  // Constant-time compare so we don't leak hash bytes via timing.
  if (!safeEqualHex(hashApiKey(fullKey), apiKey.hashedSecret)) return null;

  // The owning account must be active (suspended/pending users can't trade).
  if (apiKey.user.status !== "ACTIVE") return null;

  // Throttled lastUsedAt bump — never let bookkeeping break auth.
  const now = Date.now();
  if (!apiKey.lastUsedAt || now - apiKey.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    try {
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });
    } catch {
      // ignore — a missed lastUsedAt write must not fail the request
    }
  }

  return {
    id: String(apiKey.user.id),
    email: apiKey.user.email,
    username: apiKey.user.username,
    role: apiKey.user.role,
    scopes: apiKey.scopes,
    apiKeyId: apiKey.id,
  };
}

/** True if the authenticated key carries the given scope. */
export function hasScope(user: ApiUser, scope: Scope): boolean {
  return user.scopes.includes(scope);
}
