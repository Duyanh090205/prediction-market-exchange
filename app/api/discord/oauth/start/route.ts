import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { getOAuthConfig, buildAuthorizeUrl, randomToken, pkceChallenge } from "@/lib/discord/oauth";

// GET /api/discord/oauth/start — begin Discord account linking.
// Requires a logged-in trading user. Sets short-lived httpOnly cookies carrying
// the CSRF `state` and the PKCE `code_verifier`, then redirects to Discord.
export async function GET(request: NextRequest) {
  const basePath = process.env.TRADING_BASE_PATH || "";
  const appBase = process.env.NEXTAUTH_URL || new URL(request.url).origin;
  const home = new URL(`${basePath}/`, appBase);
  const settings = (q: string) => new URL(`${basePath}/settings/discord?${q}`, appBase);

  const user = await getLabUser();
  if (!user) return NextResponse.redirect(home);

  const { clientId, redirectUri } = getOAuthConfig();
  if (!clientId || !redirectUri) {
    return NextResponse.redirect(settings("error=config"));
  }

  const state = randomToken(32);
  const verifier = randomToken(48);
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge: pkceChallenge(verifier),
  });

  const res = NextResponse.redirect(authorizeUrl);
  // SameSite=Lax so the cookies survive Discord's top-level GET redirect back.
  // secure only in prod (localhost is http during local testing).
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 min to complete the flow
  };
  res.cookies.set("discord_oauth_state", state, opts);
  res.cookies.set("discord_oauth_verifier", verifier, opts);
  return res;
}
