/**
 * Seed a public demo: one open contract with a two-sided book, plus a reviewer
 * account whose credentials are published in the README.
 *
 *   node scripts/seed-demo.mjs
 *
 * Idempotent — safe to run again. Skips seeding if the demo contract already
 * exists, so a redeploy does not stack duplicate books.
 *
 * The reviewer account is deliberately a plain USER, not an admin: it can trade
 * and see the book, and it cannot settle contracts or touch other accounts.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_TITLE = "How many home runs will be hit league-wide on opening day?";
const REVIEWER_EMAIL = "demo@example.com";
const REVIEWER_PASSWORD = process.env.DEMO_PASSWORD || "demo-trader-2027";

async function maker(username, balance) {
  const hashedPassword = await bcrypt.hash(
    Math.random().toString(36) + Math.random().toString(36),
    12
  );
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      email: `${username}@demo.invalid`,
      hashedPassword,
      role: "LIQUIDITY_PROVIDER",
      status: "ACTIVE",
      balance,
    },
  });
}

async function main() {
  const existing = await prisma.contract.findFirst({
    where: { title: DEMO_TITLE },
  });
  if (existing) {
    console.log(`Demo contract already present (id ${existing.id}) — nothing to do.`);
    return;
  }

  const reviewer = await prisma.user.upsert({
    where: { email: REVIEWER_EMAIL },
    update: { status: "ACTIVE" },
    create: {
      username: "demo",
      email: REVIEWER_EMAIL,
      hashedPassword: await bcrypt.hash(REVIEWER_PASSWORD, 12),
      role: "USER",
      status: "ACTIVE",
      balance: 1000,
    },
  });

  const mm1 = await maker("market_maker_a", 10000);
  const mm2 = await maker("market_maker_b", 10000);

  const contract = await prisma.contract.create({
    data: {
      title: DEMO_TITLE,
      description:
        "Binary spread market. Quote a price you would both buy and sell at; " +
        "settlement pays the distance between your fill and the true answer, " +
        "capped at the contract size.",
      status: "OPEN",
      minPrice: 0,
      maxPrice: 200,
      createdById: mm1.id,
    },
  });

  // A two-sided book with real depth on both sides, tightest inside.
  const quotes = [
    { makerId: mm1.id, bid: 96, bidSize: 20, ask: 104, askSize: 20 },
    { makerId: mm2.id, bid: 93, bidSize: 35, ask: 108, askSize: 30 },
    { makerId: mm1.id, bid: 88, bidSize: 50, ask: 115, askSize: 45 },
    { makerId: mm2.id, bid: 80, bidSize: 60, ask: 124, askSize: 55 },
  ];

  for (const q of quotes) {
    await prisma.quote.create({
      data: { contractId: contract.id, status: "OPEN", ...q },
    });
  }

  console.log(`Seeded contract ${contract.id} with ${quotes.length} two-sided quotes.`);
  console.log(`Reviewer login: ${REVIEWER_EMAIL} / ${REVIEWER_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
