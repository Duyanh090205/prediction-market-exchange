// Unit tests for the Discord outbox embed formatter (lib/discord/drainerRunner.js).
// Pure function, no DB / network — verifies each event type maps to a valid embed.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { formatEmbed } = require("@/lib/discord/drainerRunner");

const COLOR_OVER = 0xef4444;
const COLOR_UNDER = 0x22c55e;
const COLOR_NEW = 0x3b82f6;
const COLOR_HINT = 0xf59e0b;

describe("formatEmbed", () => {
  test("TRADE_EXECUTED OVER → red embed with fills summary", () => {
    const body = formatEmbed("TRADE_EXECUTED", {
      contractId: 7,
      contractTitle: "Will it rain?",
      side: "OVER",
      totalFilled: 5,
      fills: [
        { size: 3, strike: 50 },
        { size: 2, strike: 55 },
      ],
    });
    const e = body.embeds[0];
    expect(e.color).toBe(COLOR_OVER);
    expect(e.title).toContain("Will it rain?");
    expect(e.description).toContain("OVER");
    expect(e.description).toContain("3@50");
    expect(e.description).toContain("2@55");
    expect(e.footer.text).toBe("Market #7");
    expect(typeof e.timestamp).toBe("string");
  });

  test("TRADE_EXECUTED UNDER → green embed", () => {
    const body = formatEmbed("TRADE_EXECUTED", {
      contractId: 1,
      contractTitle: "X",
      side: "UNDER",
      totalFilled: 1,
      fills: [{ size: 1, strike: 10 }],
    });
    expect(body.embeds[0].color).toBe(COLOR_UNDER);
  });

  test("CONTRACT_CREATED → blue embed with price band + creator", () => {
    const body = formatEmbed("CONTRACT_CREATED", {
      contractId: 3,
      title: "New market",
      description: "desc",
      minPrice: 0,
      maxPrice: 100,
      creatorName: "sam",
    });
    const e = body.embeds[0];
    expect(e.color).toBe(COLOR_NEW);
    expect(e.title).toContain("New market");
    const band = e.fields.find((f: { name: string }) => f.name === "Price band");
    expect(band.value).toBe("0–100");
    const by = e.fields.find((f: { name: string }) => f.name === "Created by");
    expect(by.value).toBe("sam");
  });

  test("CONTRACT_SETTLED → settlement value + trade count in description", () => {
    const body = formatEmbed("CONTRACT_SETTLED", {
      contractId: 9,
      contractTitle: "Mkt",
      settlementValue: 42,
      tradesSettled: 4,
    });
    const e = body.embeds[0];
    expect(e.title).toContain("Mkt");
    expect(e.description).toContain("42");
    expect(e.description).toContain("4 trade");
  });

  test("HINT_CREATED → content + author + link field", () => {
    const body = formatEmbed("HINT_CREATED", {
      contractId: 2,
      contractTitle: "Mkt2",
      content: "buy the dip",
      linkUrl: "https://example.com",
      linkLabel: "src",
      authorName: "lp1",
    });
    const e = body.embeds[0];
    expect(e.color).toBe(COLOR_HINT);
    expect(e.description).toContain("buy the dip");
    const by = e.fields.find((f: { name: string }) => f.name === "By");
    expect(by.value).toBe("lp1");
    const link = e.fields.find((f: { name: string }) => f.name === "Link");
    expect(link.value).toContain("https://example.com");
  });

  test("HINT_CREATED without link → no Link field", () => {
    const body = formatEmbed("HINT_CREATED", {
      contractId: 2,
      contractTitle: "Mkt2",
      content: "no link here",
      authorName: "lp1",
    });
    const link = body.embeds[0].fields.find((f: { name: string }) => f.name === "Link");
    expect(link).toBeUndefined();
  });

  test("title is truncated to ≤256 chars", () => {
    const body = formatEmbed("TRADE_EXECUTED", {
      contractId: 1,
      contractTitle: "z".repeat(500),
      side: "OVER",
      totalFilled: 1,
      fills: [{ size: 1, strike: 1 }],
    });
    expect(body.embeds[0].title.length).toBeLessThanOrEqual(256);
  });

  test("description is truncated to ≤4096 chars", () => {
    const body = formatEmbed("HINT_CREATED", {
      contractId: 1,
      contractTitle: "m",
      content: "z".repeat(5000),
      authorName: "a",
    });
    expect(body.embeds[0].description.length).toBeLessThanOrEqual(4096);
  });

  test("unknown eventType → throws (drainer marks DEAD)", () => {
    expect(() => formatEmbed("WAT", {})).toThrow(/unknown eventType/);
  });

  // ── Personal DM events ──────────────────────────────────────────────────
  test("ORDER_FILLED → side color + fills", () => {
    const e = formatEmbed("ORDER_FILLED", {
      contractId: 5,
      contractTitle: "Mkt",
      side: "UNDER",
      totalFilled: 4,
      fills: [{ size: 4, strike: 30 }],
    }).embeds[0];
    expect(e.color).toBe(0x22c55e); // UNDER green
    expect(e.title).toContain("filled");
    expect(e.description).toContain("4@30");
  });

  test("SETTLEMENT_RESULT → green for profit, red for loss, gray for push", () => {
    const win = formatEmbed("SETTLEMENT_RESULT", { contractId: 1, contractTitle: "M", settlementValue: 50, pnl: 120 }).embeds[0];
    expect(win.color).toBe(0x22c55e);
    expect(win.description).toContain("+120");
    const loss = formatEmbed("SETTLEMENT_RESULT", { contractId: 1, contractTitle: "M", settlementValue: 50, pnl: -80 }).embeds[0];
    expect(loss.color).toBe(0xef4444);
    expect(loss.description).toContain("-80");
    const push = formatEmbed("SETTLEMENT_RESULT", { contractId: 1, contractTitle: "M", settlementValue: 50, pnl: 0 }).embeds[0];
    expect(push.color).toBe(0x6b7280);
  });

  test("NEW_DM_MESSAGE → sender + preview", () => {
    const e = formatEmbed("NEW_DM_MESSAGE", { fromUsername: "alice", preview: "gm" }).embeds[0];
    expect(e.color).toBe(0x5865f2);
    expect(e.title).toContain("alice");
    expect(e.description).toContain("gm");
  });
});
