// LOCAL-ONLY: Resets every user's password to a known value for E2E testing.
//
// Refuses to run when NODE_ENV=production OR when DATABASE_URL points at a
// non-local host. Never bundle this in deployed images.

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run in production.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "";
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)/i.test(url);
if (!isLocal && !process.env.ALLOW_NON_LOCAL_RESET) {
  console.error(
    "DATABASE_URL does not look local. Set ALLOW_NON_LOCAL_RESET=1 to override (you almost certainly do not want to)."
  );
  process.exit(1);
}

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
const NEW_PASSWORD = process.env.RESET_TO || "password123";

async function resetPasswords() {
  const hash = await bcrypt.hash(NEW_PASSWORD, 12);
  const result = await prisma.user.updateMany({
    data: { hashedPassword: hash },
  });
  console.log(`Reset ${result.count} passwords to '${NEW_PASSWORD}' (local DB only).`);
}

resetPasswords()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
