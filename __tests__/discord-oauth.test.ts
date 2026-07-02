// Unit tests for the Discord OAuth2 helpers (lib/discord/oauth.ts).
// Pure functions only — no network.

import {
  base64url,
  randomToken,
  pkceChallenge,
  buildAuthorizeUrl,
  discordDisplayName,
  DISCORD_AUTHORIZE_URL,
} from "@/lib/discord/oauth";

describe("base64url / randomToken", () => {
  test("base64url has no +, /, or = padding", () => {
    const s = base64url(Buffer.from([251, 255, 0, 1, 2, 3, 4]));
    expect(s).not.toMatch(/[+/=]/);
  });

  test("randomToken is url-safe and ~unique", () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).not.toMatch(/[+/=]/);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});

describe("pkceChallenge", () => {
  test("matches RFC 7636 Appendix B known-answer vector", () => {
    // verifier → S256 challenge from the spec.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("buildAuthorizeUrl", () => {
  test("includes all required OAuth2 + PKCE params", () => {
    const url = buildAuthorizeUrl({
      clientId: "12345",
      redirectUri: "http://localhost:3000/trading/api/discord/oauth/callback",
      state: "st8",
      codeChallenge: "chal",
    });
    expect(url.startsWith(DISCORD_AUTHORIZE_URL)).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("12345");
    expect(u.searchParams.get("scope")).toBe("identify");
    expect(u.searchParams.get("state")).toBe("st8");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/trading/api/discord/oauth/callback");
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("prompt")).toBe("consent");
  });
});

describe("discordDisplayName", () => {
  test("prefers global_name, then username, then id", () => {
    expect(discordDisplayName({ id: "1", username: "user", global_name: "Global" })).toBe("Global");
    expect(discordDisplayName({ id: "1", username: "user", global_name: null })).toBe("user");
    expect(discordDisplayName({ id: "1", username: "" })).toBe("1");
  });
});
