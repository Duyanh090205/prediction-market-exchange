import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { emitMessageCreated } from "@/lib/socket-events";
import { enqueueDiscordDM } from "@/lib/discord/outbox";

const MAX_LEN = 500;

// POST /api/messages — send a chat message to a market (contractId) or the
// global lobby (contractId omitted/null). Any authenticated user may post.
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

    const body = await request.json();
    const text = typeof body.body === "string" ? body.body.trim() : "";
    const contractId = body.contractId != null ? Number(body.contractId) : null;
    const recipientId = body.recipientId != null ? Number(body.recipientId) : null;

    if (text.length === 0) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }
    if (text.length > MAX_LEN) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: `Message too long (max ${MAX_LEN} chars)` }, { status: 400 });
    }
    if (contractId != null && !Number.isInteger(contractId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid contractId" }, { status: 400 });
    }
    if (recipientId != null && contractId != null) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "A message cannot target both a market and a recipient" }, { status: 400 });
    }

    if (recipientId != null) {
      if (!Number.isInteger(recipientId)) {
        reqLog.finish(400, user.id);
        return NextResponse.json({ error: "Invalid recipientId" }, { status: 400 });
      }
      if (recipientId === Number(user.id)) {
        reqLog.finish(400, user.id);
        return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
      }
      const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true } });
      if (!recipient) {
        reqLog.finish(404, user.id);
        return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
      }
    }

    if (contractId != null) {
      const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: { id: true } });
      if (!contract) {
        reqLog.finish(404, user.id);
        return NextResponse.json({ error: "Contract not found" }, { status: 404 });
      }
    }

    const msg = await prisma.message.create({
      data: { contractId, recipientId, userId: Number(user.id), body: text },
      include: { user: { select: { id: true, username: true } } },
    });

    const payload = {
      id: msg.id,
      contractId: msg.contractId,
      recipientId: msg.recipientId,
      userId: msg.userId,
      username: msg.user.username,
      body: msg.body,
      createdAt: msg.createdAt.toISOString(),
    };

    emitMessageCreated(payload);

    // Notify the recipient of a new DM so they know to check it. Open channels
    // (lobby/market) don't notify — that would be too noisy.
    if (recipientId != null) {
      await prisma.notification.create({
        data: {
          userId: recipientId,
          message: `💬 New message from ${msg.user.username}`,
          linkUrl: `/players/${msg.userId}`,
        },
      });

      // Mirror the DM notice to Discord if the recipient has linked their account.
      // Best-effort: never fail the message send over a Discord/DB hiccup.
      try {
        const recipientDiscord = await prisma.user.findUnique({
          where: { id: recipientId },
          select: { discordId: true },
        });
        if (recipientDiscord?.discordId) {
          await enqueueDiscordDM(
            "NEW_DM_MESSAGE",
            { fromUsername: msg.user.username, preview: text },
            recipientDiscord.discordId,
            { dedupeKey: `dm-msg:${msg.id}` }
          );
        }
      } catch {
        /* best-effort */
      }
    }

    reqLog.finish(201, user.id);
    return NextResponse.json({ message: payload }, { status: 201 });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
