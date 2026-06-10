/**
 * Chat/DM routing + privacy (#8) — real Postgres. Replicates the EXACT `where`
 * clauses the pages use (lobby: app/chat, market: markets/[id], DM:
 * players/[id]) and asserts messages never leak across channels.
 *
 * Gated behind RUN_DB_ITEST=1.
 */

import { PrismaClient } from "@prisma/client";

const RUN = process.env.RUN_DB_ITEST === "1";
const d = RUN ? describe : describe.skip;
const prisma = RUN ? new PrismaClient() : (null as unknown as PrismaClient);

d("chat routing + privacy (real Postgres)", () => {
  let A = 0, B = 0, C = 0, contractId = 0;
  const ids: Record<string, number> = {};

  async function mkUser(tag: string) {
    const s = `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
    const u = await prisma.user.create({
      data: { username: `chat_${tag}_${s}`, email: `chat_${tag}_${s}@test.local`, hashedPassword: "x", role: "USER", status: "ACTIVE", balance: 0 },
    });
    return u.id;
  }

  beforeAll(async () => {
    A = await mkUser("a");
    B = await mkUser("b");
    C = await mkUser("c");
    const c = await prisma.contract.create({
      data: { title: `CHAT ${Date.now().toString(36)}`, description: "x", status: "OPEN", minPrice: 0, maxPrice: 100 },
    });
    contractId = c.id;

    const mk = async (key: string, data: { contractId: number | null; userId: number; recipientId: number | null; body: string }) => {
      const m = await prisma.message.create({ data });
      ids[key] = m.id;
    };
    await mk("lobby", { contractId: null, userId: A, recipientId: null, body: "lobby" });
    await mk("market", { contractId, userId: A, recipientId: null, body: "market" });
    await mk("dmAB", { contractId: null, userId: A, recipientId: B, body: "a→b" });
    await mk("dmBA", { contractId: null, userId: B, recipientId: A, body: "b→a" });
    await mk("dmAC", { contractId: null, userId: A, recipientId: C, body: "a→c" });
  });

  afterAll(async () => {
    await prisma.message.deleteMany({
      where: { OR: [{ user: { username: { startsWith: "chat_" } } }, { recipient: { username: { startsWith: "chat_" } } }] },
    });
    await prisma.contract.deleteMany({ where: { title: { startsWith: "CHAT " } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: "chat_" } } });
    await prisma.$disconnect();
  });

  const has = (rows: { id: number }[], key: string) => rows.some((r) => r.id === ids[key]);

  test("lobby query (contractId null, recipientId null) excludes DMs and market chat", async () => {
    const rows = await prisma.message.findMany({ where: { contractId: null, recipientId: null } });
    expect(has(rows, "lobby")).toBe(true);
    expect(has(rows, "dmAB")).toBe(false); // DM must NOT leak into lobby
    expect(has(rows, "dmBA")).toBe(false);
    expect(has(rows, "dmAC")).toBe(false);
    expect(has(rows, "market")).toBe(false);
  });

  test("market query (contractId = X) returns only that market's chat", async () => {
    const rows = await prisma.message.findMany({ where: { contractId } });
    expect(has(rows, "market")).toBe(true);
    expect(has(rows, "lobby")).toBe(false);
    expect(has(rows, "dmAB")).toBe(false);
  });

  test("DM thread A↔B contains both directions, nothing else", async () => {
    const rows = await prisma.message.findMany({
      where: { OR: [{ userId: A, recipientId: B }, { userId: B, recipientId: A }] },
    });
    expect(has(rows, "dmAB")).toBe(true);
    expect(has(rows, "dmBA")).toBe(true);
    expect(has(rows, "dmAC")).toBe(false); // A's DM to C is NOT in the A↔B thread
    expect(has(rows, "lobby")).toBe(false);
    expect(has(rows, "market")).toBe(false);
  });

  test("privacy: C's thread with A cannot see the A↔B DMs", async () => {
    const rows = await prisma.message.findMany({
      where: { OR: [{ userId: C, recipientId: A }, { userId: A, recipientId: C }] },
    });
    expect(has(rows, "dmAC")).toBe(true);
    expect(has(rows, "dmAB")).toBe(false); // B's private DM must be invisible to C
    expect(has(rows, "dmBA")).toBe(false);
  });
});
