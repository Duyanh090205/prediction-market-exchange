import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { getOAuthConfig, exchangeCode, fetchDiscordUser, discordDisplayName } from "@/lib/discord/oauth";

// GET /api/discord/oauth/callback — Discord redirects here with ?code&state.
// Verifies state (CSRF), exchanges the code server-side (with PKCE verifier),
// reads the Discord identity, and links it to the current trading user.
export async function GET(request: NextRequest) {
  const basePath = process.env.TRADING_BASE_PATH || "";
  const appBase = process.env.NEXTAUTH_URL || new URL(request.url).origin;
  const home = new URL(`${basePath}/`, appBase);

  // Always clear the one-time flow cookies on the way out.
  const finish = (q: string) => {
    const res = NextResponse.redirect(new URL(`${basePath}/settings/discord?${q}`, appBase));
    res.cookies.set("discord_oauth_state", "", { path: "/", maxAge: 0 });
    res.cookies.set("discord_oauth_verifier", "", { path: "/", maxAge: 0 });
    return res;
  };

  const url = new URL(request.url);

  // User declined on Discord's consent screen.
  if (url.searchParams.get("error")) {
    return finish("error=denied");
  }

  const user = await getLabUser();
  if (!user) return NextResponse.redirect(home);

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieState = request.cookies.get("discord_oauth_state")?.value;
  const verifier = request.cookies.get("discord_oauth_verifier")?.value;

  // CSRF: the state echoed by Discord must match the one we stored. Missing code
  // or verifier means the flow is malformed/expired.
  if (!state || !cookieState || state !== cookieState || !code || !verifier) {
    return finish("error=state");
  }

  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  if (!clientId || !clientSecret || !redirectUri) {
    return finish("error=config");
  }

  const token = await exchangeCode({ code, codeVerifier: verifier, clientId, clientSecret, redirectUri });
  if (!token?.access_token) {
    return finish("error=exchange");
  }

  const identity = await fetchDiscordUser(token.access_token);
  if (!identity?.id) {
    return finish("error=profile");
  }

  try {
    await prisma.user.update({
      where: { id: Number(user.id) },
      data: {
        discordId: identity.id,
        discordUsername: discordDisplayName(identity),
        discordLinkedAt: new Date(),
      },
    });
  } catch (e) {
    // @unique violation = this Discord account is already linked to another user.
    if ((e as { code?: string })?.code === "P2002") {
      return finish("error=already_linked");
    }
    logError("GET", "/api/discord/oauth/callback", e instanceof Error ? e : new Error(String(e)));
    return finish("error=save");
  }

  return finish("linked=1");
}
