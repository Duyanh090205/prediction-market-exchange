// Idempotency handler — UUIDv7, dedup by (actorId, action, key).
//
// Required for any non-idempotent state change so retries (network blips,
// double-tap on mobile, browser auto-resume) don't multiply effects.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

const UUIDV7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdempotencyAction =
  | "order"
  | "settle-contract"
  | "approve-user"
  | "deny-user"
  | "adjust-balance";

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/**
 * Validate Idempotency-Key header.
 * Returns error response if invalid, null if valid.
 */
export function validateIdempotencyHeader(
  request: NextRequest
): NextResponse | null {
  const key = request.headers.get("Idempotency-Key");
  if (!key) {
    return NextResponse.json(
      { error: "Idempotency-Key header is required" },
      { status: 400 }
    );
  }
  if (!UUIDV7_REGEX.test(key)) {
    return NextResponse.json(
      { error: "Idempotency-Key must be a valid UUIDv7" },
      { status: 422 }
    );
  }
  return null;
}

/**
 * Check and store idempotency key.
 *
 * Returns:
 *   { cached: true, response } — replay cached response
 *   { cached: false }          — proceed, call storeidempotency after
 *   throws on hash mismatch (caller should return 422)
 */
export async function checkIdempotency(
  actorId: number,
  action: IdempotencyAction,
  key: string,
  body: unknown
): Promise<{ cached: true; response: NextResponse } | { cached: false }> {
  const requestHash = hashBody(body);

  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      actorId_action_idempotencyKey: { actorId, action, idempotencyKey: key },
    },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyMismatchError();
    }
    const parsed = JSON.parse(existing.response) as {
      status: number;
      body: unknown;
    };
    return {
      cached: true,
      response: NextResponse.json(parsed.body, { status: parsed.status }),
    };
  }

  return { cached: false };
}

/**
 * Store idempotency key after successful processing.
 */
export async function storeIdempotency(
  actorId: number,
  action: IdempotencyAction,
  key: string,
  body: unknown,
  responseBody: unknown,
  status: number
): Promise<void> {
  const requestHash = hashBody(body);
  await prisma.idempotencyKey.create({
    data: {
      actorId,
      action,
      idempotencyKey: key,
      requestHash,
      response: JSON.stringify({ status, body: responseBody }),
    },
  });
}

export class IdempotencyMismatchError extends Error {
  constructor() {
    super("Same key, different payload");
  }
}

/**
 * Cleanup idempotency keys older than 24 hours.
 */
export async function cleanupIdempotencyKeys(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
