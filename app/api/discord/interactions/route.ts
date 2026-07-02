import { NextRequest, NextResponse } from "next/server";
import { verifyDiscordRequest, handleInteraction } from "@/lib/discord/interactions";

// POST /api/discord/interactions — Discord HTTP Interactions endpoint.
// Public (in middleware PUBLIC_PREFIXES) and unauthenticated by cookie: trust is
// established by the Ed25519 signature, verified on the RAW body before parsing.
export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await request.text();

  const publicKey = process.env.DISCORD_PUBLIC_KEY || "";
  if (!verifyDiscordRequest(rawBody, signature, timestamp, publicKey)) {
    // Discord requires a 401 on bad signatures (it also probes with invalid ones).
    return new NextResponse("invalid request signature", { status: 401 });
  }

  let interaction: unknown;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  try {
    const response = await handleInteraction(interaction);
    return NextResponse.json(response);
  } catch {
    // Never leave Discord hanging — a generic ephemeral error keeps the UX sane.
    return NextResponse.json({
      type: 4,
      data: { flags: 64, content: "Có lỗi xảy ra khi xử lý lệnh. Thử lại sau." },
    });
  }
}
