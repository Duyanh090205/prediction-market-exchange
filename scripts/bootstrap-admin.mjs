/**
 * Promote one account to ADMIN and activate it.
 *
 *   ADMIN_EMAIL=you@example.com node scripts/bootstrap-admin.mjs
 *
 * Registration creates accounts in PENDING status and an admin has to approve
 * them, which leaves a fresh database unable to bootstrap itself: nobody can
 * approve the first admin. This does that one step directly, and does it the
 * same way the approve endpoint would — status, balance, and the INITIAL_SEED
 * ledger row, so the balance has a provenance record like every other balance.
 *
 * Run it once per deployment. It does not create accounts; register through the
 * app first, then run this against that email.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_STARTING_BALANCE = 1000;

async function main() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.error("Set ADMIN_EMAIL to the address of an already-registered account.");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, username: true, status: true, role: true, balance: true },
  });
  if (!user) {
    console.error(`No account with email ${email}. Register through the app first.`);
    process.exitCode = 1;
    return;
  }

  if (user.role === "ADMIN" && user.status === "ACTIVE") {
    console.log(`${user.username} is already an active admin — nothing to do.`);
    return;
  }

  const grant = user.balance > 0 ? 0 : DEFAULT_STARTING_BALANCE;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: user.id },
      data: {
        status: "ACTIVE",
        role: "ADMIN",
        ...(grant > 0 ? { balance: grant } : {}),
      },
      select: { balance: true },
    });

    if (grant > 0) {
      await tx.balanceLedger.create({
        data: {
          userId: user.id,
          delta: grant,
          balanceAfter: updated.balance,
          eventType: "INITIAL_SEED",
          initiatedBy: user.id,
          note: `Bootstrap admin - granted ${grant} starting balance`,
        },
      });
    }
  });

  console.log(`${user.username} <${email}> is now ACTIVE and ADMIN` +
              (grant > 0 ? `, balance ${grant}.` : "."));
  console.log("Note: admins are blocked from trading at the API layer by design.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
