// Discord outbound — ENQUEUE side.
//
// A domain event (trade filled, market created/settled, hint posted) appends one
// row to the DiscordOutbox table. The DRAIN side lives in lib/discord/drainerRunner.js
// (plain CommonJS, started by server.js) which formats + POSTs to the channel webhook.
//
// Design notes:
//   - Called POST-COMMIT (after the matching/settle transaction commits), exactly
//     like the existing prisma.notification.create / emit* calls. A missed Discord
//     post must NEVER break a trade/settle, so this swallows every error.
//   - `dedupeKey` is @unique → a retried route (e.g. idempotent settle) can't enqueue
//     the same event twice. A unique-violation is therefore an EXPECTED no-op, not a bug.
//   - We never pass a Prisma tx client here: enqueuing inside a caller's transaction
//     would let a unique-violation abort that transaction (Postgres marks the tx failed
//     even if JS catches it). Post-commit + standalone write avoids that hazard.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// Public channel-feed events (→ webhook).
export type DiscordEventType =
  | "TRADE_EXECUTED"
  | "CONTRACT_CREATED"
  | "CONTRACT_SETTLED"
  | "HINT_CREATED";

// Personal DM events (→ bot DM to a linked user).
export type DiscordDmEventType =
  | "ORDER_FILLED"
  | "SETTLEMENT_RESULT"
  | "NEW_DM_MESSAGE";

export async function enqueueDiscordEvent(
  eventType: DiscordEventType,
  payload: Record<string, unknown>,
  opts?: { dedupeKey?: string }
): Promise<void> {
  try {
    await prisma.discordOutbox.create({
      data: {
        eventType,
        channel: "feed",
        payload: payload as Prisma.InputJsonValue,
        dedupeKey: opts?.dedupeKey ?? null,
      },
    });
  } catch (err) {
    // Unique-violation on dedupeKey (P2002) = already enqueued → fine. Any other
    // error must not propagate into the trade/settle path; log and move on.
    const code = (err as { code?: string })?.code;
    if (code === "P2002") return;
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        event: "discord:enqueue_failed",
        eventType,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

// Enqueue a personal DM to a linked user. `targetDiscordId` is the recipient's
// Discord snowflake — resolve it from User.discordId BEFORE calling (callers skip
// the DM entirely when the user hasn't linked Discord, so the bot never needs DB
// access). Same fire-and-forget safety as enqueueDiscordEvent.
export async function enqueueDiscordDM(
  eventType: DiscordDmEventType,
  payload: Record<string, unknown>,
  targetDiscordId: string,
  opts?: { dedupeKey?: string }
): Promise<void> {
  try {
    await prisma.discordOutbox.create({
      data: {
        eventType,
        channel: "dm",
        targetDiscordId,
        payload: payload as Prisma.InputJsonValue,
        dedupeKey: opts?.dedupeKey ?? null,
      },
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") return;
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        event: "discord:enqueue_dm_failed",
        eventType,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}
