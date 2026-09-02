/**
 * Sandbox accounts for "Enter as demo trader" on the public deployment.
 *
 * The deployment is a portfolio link. Registration alone does not work as a way
 * in — POST /api/auth/register creates accounts PENDING and auth.ts refuses to
 * sign in anything that is not ACTIVE, so a visitor who registers is told to
 * wait for an admin who is not watching. This mints a throwaway ACTIVE account
 * instead, with play money, so the matching engine can actually be exercised.
 *
 * That makes it the one write surface on this deployment reachable without
 * credentials, so it is bounded three ways:
 *
 *   rate limit   3 mints per hour per IP (lib/rate-limiter.ts)
 *   cap          DEMO_LIVE_CAP live accounts, refused past that
 *   TTL          DEMO_TTL_MS, then reapExpiredDemoAccounts() clears them
 *
 * Demo accounts are ordinary USER rows. What they cannot do is enforced at the
 * routes that matter: no API keys (app/api/keys), no market creation
 * (app/api/contracts), and a tighter per-minute order ceiling than a real
 * account (app/api/orders).
 */

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;
export const DEMO_LIVE_CAP = 200;
export const DEMO_STARTING_BALANCE = 1000;

export interface MintedDemoAccount {
  username: string;
  email: string;
  /** Plaintext, returned once. See mintDemoAccount() for why. */
  password: string;
}

/** Live = mintable-against. Retired accounts keep their rows but not their slot. */
export function countLiveDemoAccounts(): Promise<number> {
  return prisma.user.count({ where: { isDemo: true, status: "ACTIVE" } });
}

/**
 * Expire demo accounts past their TTL.
 *
 * Two outcomes, because a demo account that traded is not the same object as
 * one that was clicked and abandoned:
 *
 *   never traded  deleted outright, with its dependent rows. This is the case
 *                 that actually accumulates, and the rows are worth nothing.
 *
 *   traded        open quotes cancelled, account SUSPENDED. Its fills stay on
 *                 the tape: the Confirmed Trades table joins both sides of every
 *                 print to a username, so deleting the row would either break
 *                 that page or force the fills to be deleted with it — throwing
 *                 away real matching-engine output to save a few hundred bytes.
 *                 SUSPENDED frees the cap slot, and auth.ts refuses to sign a
 *                 non-ACTIVE account in, so the account is spent either way.
 */
export async function reapExpiredDemoAccounts(): Promise<{
  deleted: number;
  retired: number;
}> {
  const cutoff = new Date(Date.now() - DEMO_TTL_MS);
  const expired = await prisma.user.findMany({
    where: { isDemo: true, status: "ACTIVE", createdAt: { lt: cutoff } },
    select: {
      id: true,
      _count: { select: { tradesAsTaker: true, tradesAsMaker: true } },
    },
  });

  let deleted = 0;
  let retired = 0;

  for (const u of expired) {
    const traded = u._count.tradesAsTaker + u._count.tradesAsMaker > 0;

    if (traded) {
      await prisma.$transaction([
        prisma.quote.updateMany({
          where: { makerId: u.id, status: "OPEN" },
          data: { status: "CANCELLED" },
        }),
        prisma.user.update({
          where: { id: u.id },
          data: { status: "SUSPENDED" },
        }),
      ]);
      retired++;
      continue;
    }

    // No trades, so no Trade row points at this user or at their quotes, and
    // every remaining reference is a row nobody else can see. Nothing in the
    // schema cascades, so the dependents go first, in FK order.
    await prisma.$transaction([
      prisma.contract.updateMany({
        where: { createdById: u.id },
        data: { createdById: null },
      }),
      prisma.quote.deleteMany({ where: { makerId: u.id } }),
      prisma.hint.deleteMany({ where: { authorId: u.id } }),
      prisma.message.deleteMany({
        where: { OR: [{ userId: u.id }, { recipientId: u.id }] },
      }),
      prisma.notification.deleteMany({ where: { userId: u.id } }),
      prisma.balanceLedger.deleteMany({ where: { userId: u.id } }),
      prisma.apiKey.deleteMany({ where: { userId: u.id } }),
      prisma.user.delete({ where: { id: u.id } }),
    ]);
    deleted++;
  }

  return { deleted, retired };
}

/**
 * Create one sandbox account and hand back its credentials.
 *
 * The plaintext password is returned so the browser can sign in through the
 * ordinary NextAuth credentials provider — the same authorize() path, rate
 * limit and status check a real password login goes through. The alternative
 * was a second way to mint a session that skips all of that, which is a worse
 * thing to have in an auth system than a throwaway 32-character secret for an
 * account holding play money.
 */
export async function mintDemoAccount(): Promise<MintedDemoAccount> {
  // 4 bytes of suffix; retry covers the birthday case rather than assuming it away.
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = `demo_${randomBytes(4).toString("hex")}`;
    const email = `${username}@demo.local`;
    const password = randomBytes(16).toString("hex");
    const hashedPassword = await bcrypt.hash(password, 12);

    const taken = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { id: true },
    });
    if (taken) continue;

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          hashedPassword,
          role: "USER",
          status: "ACTIVE",
          balance: DEMO_STARTING_BALANCE,
          isDemo: true,
        },
        select: { id: true },
      });
      // The same ledger row an approved account gets on seeding, so the balance
      // has a provenance entry instead of appearing from nowhere.
      await tx.balanceLedger.create({
        data: {
          userId: user.id,
          delta: DEMO_STARTING_BALANCE,
          balanceAfter: DEMO_STARTING_BALANCE,
          eventType: "INITIAL_SEED",
          note: "Demo sandbox account opening balance",
        },
      });
    });

    return { username, email, password };
  }

  throw new Error("Could not allocate a demo username");
}

/** Where to drop a new demo trader: the busiest open market, else the list. */
export async function demoLandingPath(): Promise<string> {
  const contract = await prisma.contract.findFirst({
    where: { status: "OPEN" },
    orderBy: [{ quotes: { _count: "desc" } }, { id: "desc" }],
    select: { id: true },
  });
  return contract ? `/markets/${contract.id}` : "/";
}
