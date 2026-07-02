// Discord OAuth2 helpers (Phase 2 — account linking).
//
// Standard Authorization Code + PKCE flow with the `identify` scope:
//   start    → build authorize URL (state CSRF + S256 code_challenge), set cookies
//   callback → verify state, exchange code (+code_verifier) server-side, read /users/@me
//
// Pure functions live here so they can be unit-tested without a browser/DB.

import crypto from "node:crypto";

export const DISCORD_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_USER_URL = "https://discord.com/api/users/@me";

export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cryptographically-random URL-safe token (state, PKCE verifier). */
export function randomToken(bytes = 32): string {
  return base64url(crypto.randomBytes(bytes));
}

/** PKCE S256: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export function getOAuthConfig(): {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
} {
  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_OAUTH_REDIRECT_URI,
  };
}

export function buildAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL(DISCORD_AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("scope", "identify");
  u.searchParams.set("state", p.state);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

/** Exchange the authorization code (with PKCE verifier) for an access token. */
export async function exchangeCode(p: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ access_token: string } | null> {
  const body = new URLSearchParams({
    client_id: p.clientId,
    client_secret: p.clientSecret,
    grant_type: "authorization_code",
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.codeVerifier,
  });
  try {
    const res = await fetch(DISCORD_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Network/DNS error reaching Discord — treat as a failed exchange so the
    // callback redirects gracefully instead of throwing a 500.
    return null;
  }
}

export interface DiscordIdentity {
  id: string;
  username: string;
  global_name?: string | null;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordIdentity | null> {
  try {
    const res = await fetch(DISCORD_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Best display name for a Discord identity (global name preferred). */
export function discordDisplayName(u: DiscordIdentity): string {
  return u.global_name || u.username || u.id;
}
