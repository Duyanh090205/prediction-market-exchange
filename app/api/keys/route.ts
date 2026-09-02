import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import {
  checkKeyCreateRateLimit,
  recordKeyCreateAttempt,
} from "@/lib/rate-limiter";
import {
  generateApiKey,
  isValidScope,
  SCOPE_READ,
  type Scope,
} from "@/lib/apiAuth";

// Cookie-authenticated management of the caller's own API keys.
// (The bot-facing namespace is /api/v1, authenticated by the keys minted here.)

// GET /api/keys — list the caller's keys (never returns secrets).
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const keys = await prisma.apiKey.findMany({
      where: { userId: Number(user.id) },
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ keys });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/keys — mint a new key. Returns the full secret EXACTLY ONCE.
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // A demo account is handed to anyone with the link. An API key outlives the
    // account's 24h TTL and authenticates against /api/v1 with no session, so
    // this is the one capability a sandbox visitor does not get.
    if (user.isDemo) {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Demo accounts cannot mint API keys" },
        { status: 403 }
      );
    }

    // Throttle key creation per user so a logged-in account can't spam keys.
    const rl = await checkKeyCreateRateLimit(user.id);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil((rl.retryAfterMs ?? 3_600_000) / 1000);
      reqLog.finish(429, user.id);
      return NextResponse.json(
        { error: "Too many keys created recently — please wait" },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }
    await recordKeyCreateAttempt(user.id);

    const body = await request.json();
    const { label, scopes } = body;

    if (!label || typeof label !== "string" || label.trim().length === 0) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Label is required" }, { status: 400 });
    }
    if (label.length > 80) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "Label must be 80 characters or fewer" },
        { status: 400 }
      );
    }

    // Normalise scopes: validated subset of the known scopes, always including
    // "read" (a key that can do nothing is useless), defaulting to read-only.
    let requested: Scope[] = [SCOPE_READ];
    if (Array.isArray(scopes) && scopes.length > 0) {
      const valid = scopes.filter(isValidScope);
      requested = Array.from(new Set([SCOPE_READ, ...valid]));
    }

    // Mint the key, retrying on the (astronomically rare) keyPrefix collision
    // so a 1-in-2^48 clash returns a fresh key instead of a 500.
    let fullKey = "";
    let apiKey: {
      id: number;
      label: string;
      keyPrefix: string;
      scopes: string[];
      createdAt: Date;
    } | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const gen = generateApiKey();
      try {
        apiKey = await prisma.apiKey.create({
          data: {
            userId: Number(user.id),
            label: label.trim(),
            keyPrefix: gen.keyPrefix,
            hashedSecret: gen.hashedSecret,
            scopes: requested,
          },
          select: {
            id: true,
            label: true,
            keyPrefix: true,
            scopes: true,
            createdAt: true,
          },
        });
        fullKey = gen.fullKey;
        break;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          continue; // keyPrefix collision — regenerate and retry
        }
        throw e;
      }
    }

    if (!apiKey) {
      reqLog.finish(500, user.id);
      return NextResponse.json(
        { error: "Could not generate a unique key, please retry" },
        { status: 500 }
      );
    }

    reqLog.finish(201, user.id, { apiKeyId: apiKey.id });
    // `secret` is the only time the plaintext key is ever returned.
    return NextResponse.json({ apiKey, secret: fullKey }, { status: 201 });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
