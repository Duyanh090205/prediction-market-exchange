// Unit tests for the Discord interactions endpoint helpers — no DB.
// Verifies the Ed25519 signature check end-to-end with a generated keypair, and
// the PING → PONG path.

import crypto from "node:crypto";
import { verifyDiscordRequest, handleInteraction } from "@/lib/discord/interactions";

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  // Raw 32-byte public key = last 32 bytes of the 44-byte SPKI DER.
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, publicKeyHex: spki.subarray(12).toString("hex") };
}

describe("verifyDiscordRequest", () => {
  const { privateKey, publicKeyHex } = makeKeypair();
  const timestamp = "1700000000";
  const body = JSON.stringify({ type: 1 });
  const signature = crypto.sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

  test("accepts a correctly signed request", () => {
    expect(verifyDiscordRequest(body, signature, timestamp, publicKeyHex)).toBe(true);
  });

  test("rejects a tampered body", () => {
    expect(verifyDiscordRequest(body + " ", signature, timestamp, publicKeyHex)).toBe(false);
  });

  test("rejects a tampered timestamp", () => {
    expect(verifyDiscordRequest(body, signature, "1700000001", publicKeyHex)).toBe(false);
  });

  test("rejects a wrong public key", () => {
    const other = makeKeypair().publicKeyHex;
    expect(verifyDiscordRequest(body, signature, timestamp, other)).toBe(false);
  });

  test("rejects missing signature/timestamp", () => {
    expect(verifyDiscordRequest(body, null, timestamp, publicKeyHex)).toBe(false);
    expect(verifyDiscordRequest(body, signature, null, publicKeyHex)).toBe(false);
  });

  test("garbage signature does not throw, returns false", () => {
    expect(verifyDiscordRequest(body, "zz", timestamp, publicKeyHex)).toBe(false);
  });
});

describe("handleInteraction PING", () => {
  test("type 1 → PONG (type 1), no DB access", async () => {
    const res = await handleInteraction({ type: 1 });
    expect(res).toEqual({ type: 1 });
  });
});

describe("handleInteraction /help", () => {
  test("help → command list, no DB access", async () => {
    const res = await handleInteraction({ type: 2, data: { name: "help" } });
    expect(JSON.stringify(res.data.embeds)).toContain("/markets");
    expect(JSON.stringify(res.data.embeds)).toContain("/cancel");
  });
});
