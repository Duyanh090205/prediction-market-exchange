/**
 * Discord interaction handlers against real Postgres — exercises the actual
 * command + trade-confirm path with synthetic interaction payloads (no Discord
 * round-trip). Gated behind RUN_DB_ITEST=1.
 */

import { PrismaClient } from "@prisma/client";
import { handleInteraction, buildOrderResult, resolveUser, cancelUserQuote } from "@/lib/discord/interactions";

const RUN = process.env.RUN_DB_ITEST === "1";
const d = RUN ? describe : describe.skip;
const prisma = RUN ? new PrismaClient() : (null as unknown as PrismaClient);

d("Discord interactions (real Postgres)", () => {
  const uniq = `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
  const discordIdA = `dtest_A_${uniq}`;
  let A = 0; // taker, linked to Discord
  let B = 0; // maker
  let contractId = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function cmd(name: string, options: any[] = [], discordId = discordIdA) {
    return handleInteraction({ type: 2, member: { user: { id: discordId } }, data: { name, options } });
  }

  beforeAll(async () => {
    const a = await prisma.user.create({
      data: { username: `di_a_${uniq}`, email: `di_a_${uniq}@t.local`, hashedPassword: "x", role: "USER", status: "ACTIVE", balance: 1_000_000, discordId: discordIdA },
    });
    A = a.id;
    const b = await prisma.user.create({
      data: { username: `di_b_${uniq}`, email: `di_b_${uniq}@t.local`, hashedPassword: "x", role: "USER", status: "ACTIVE", balance: 1_000_000 },
    });
    B = b.id;
    const c = await prisma.contract.create({
      data: { title: `DI ${uniq}`, description: "x", status: "OPEN", minPrice: 0, maxPrice: 100 },
    });
    contractId = c.id;
    // Resting ask from B so a MARKET OVER from A can fill.
    await prisma.quote.create({
      data: { contractId, makerId: B, ask: 50, askSize: 10, status: "OPEN" },
    });
  });

  afterAll(async () => {
    if (!RUN) return;
    // Outbox rows enqueued by the fills (feed + DM) — remove so a real drainer
    // never posts this test trade to the live channel.
    const trades = await prisma.trade.findMany({ where: { contractId }, select: { id: true } });
    const keys = trades.flatMap((t) => [`order-fill:${t.id}`, `dm-fill:${t.id}`]);
    await prisma.discordOutbox.deleteMany({ where: { OR: [{ dedupeKey: { in: keys } }, { targetDiscordId: discordIdA }] } });
    // FK-safe order: dependents before parents.
    await prisma.trade.deleteMany({ where: { contractId } });
    await prisma.quote.deleteMany({ where: { contractId } });
    await prisma.pricePoint.deleteMany({ where: { contractId } });
    await prisma.balanceLedger.deleteMany({ where: { userId: { in: [A, B] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [A, B] } } });
    await prisma.idempotencyKey.deleteMany({ where: { actorId: { in: [A, B] } } });
    await prisma.contract.delete({ where: { id: contractId } });
    await prisma.user.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  test("/markets lists the open contract", async () => {
    const res = await cmd("markets");
    expect(res.type).toBe(4);
    expect(JSON.stringify(res.data.embeds)).toContain(`#${contractId}`);
  });

  test("/price shows the resting ask", async () => {
    const res = await cmd("price", [{ name: "market", value: contractId }]);
    expect(JSON.stringify(res.data.embeds)).toContain("50");
  });

  test("/portfolio for the linked user shows balance", async () => {
    const res = await cmd("portfolio");
    expect(JSON.stringify(res.data.embeds)).toContain("1000000");
  });

  test("/portfolio for an unlinked discord id → not-linked prompt", async () => {
    const res = await cmd("portfolio", [], "unknown_discord_id");
    expect(res.data.content).toMatch(/isn't linked/i);
  });

  test("/order preview returns Confirm/Cancel buttons, then buildOrderResult fills", async () => {
    const preview = await cmd("order", [
      { name: "market", value: contractId },
      { name: "side", value: "OVER" },
      { name: "size", value: 5 },
      { name: "type", value: "MARKET" },
    ]);
    expect(preview.type).toBe(4);
    const button = preview.data.components[0].components[0];
    expect(button.custom_id.startsWith("confirm-order|")).toBe(true);

    // The deferred follow-up runs buildOrderResult — test it directly (awaitable).
    const user = await resolveUser(discordIdA);
    const result = await buildOrderResult(user!, button.custom_id);
    expect(JSON.stringify(result.embeds)).toContain("Order placed");

    const trades = await prisma.trade.findMany({ where: { contractId, takerId: A } });
    expect(trades.reduce((s, t) => s + t.size, 0)).toBe(5);
  });

  test("buildOrderResult is idempotent — same custom_id does not double-fill", async () => {
    const preview = await cmd("order", [
      { name: "market", value: contractId },
      { name: "side", value: "OVER" },
      { name: "size", value: 2 },
      { name: "type", value: "MARKET" },
    ]);
    const customId = preview.data.components[0].components[0].custom_id;
    const user = await resolveUser(discordIdA);
    await buildOrderResult(user!, customId);
    await buildOrderResult(user!, customId); // same baked-in Idempotency-Key
    const trades = await prisma.trade.findMany({ where: { contractId, takerId: A } });
    // 5 (previous test) + 2 (this, once) = 7; a double-fill would be 9.
    expect(trades.reduce((s, t) => s + t.size, 0)).toBe(7);
  });

  test("Confirm button → deferred ack (type 6)", async () => {
    const confirm = await handleInteraction({
      type: 3,
      application_id: "app",
      token: "tok",
      member: { user: { id: discordIdA } },
      data: { custom_id: "confirm-order|0|OVER|1|MARKET||noop" }, // market #0 won't fill; just checking the ack
    });
    expect(confirm.type).toBe(6);
    await new Promise((r) => setTimeout(r, 300)); // let the fire-and-forget follow-up settle before teardown
  });

  test("/leaderboard lists top balances", async () => {
    const res = await cmd("leaderboard");
    expect(res.data.embeds[0].title).toContain("Leaderboard");
    expect(JSON.stringify(res.data.embeds)).toContain("1000000"); // A and B both hold 1,000,000
  });

  test("autocomplete suggests the market by name", async () => {
    const res = await handleInteraction({
      type: 4,
      data: { name: "price", options: [{ name: "market", focused: true, value: "DI" }] },
    });
    expect(res.type).toBe(8);
    expect(JSON.stringify(res.data.choices)).toContain(`#${contractId}`);
  });

  test("/cancel lists a resting order and cancelUserQuote cancels it", async () => {
    const user = await resolveUser(discordIdA);
    // A LIMIT OVER @ 45 sits below the ask (50) → rests as a bid quote owned by A.
    await buildOrderResult(user!, `confirm-order|${contractId}|OVER|3|LIMIT|45|cancelseed`);
    const resting = await prisma.quote.findMany({ where: { makerId: A, status: "OPEN" } });
    expect(resting.length).toBeGreaterThan(0);

    const list = await cmd("cancel");
    expect(JSON.stringify(list.data.embeds)).toContain("resting orders");
    expect(list.data.components[0].components[0].custom_id.startsWith("cancel-quote|")).toBe(true);

    const r = await cancelUserQuote(A, resting[0].id);
    expect(r.ok).toBe(true);
    const after = await prisma.quote.findUnique({ where: { id: resting[0].id } });
    expect(after!.status).toBe("CANCELLED");

    // Wrong owner can't cancel.
    const r2 = await cancelUserQuote(B, resting[0].id);
    expect(r2.ok).toBe(false);
  });
});
