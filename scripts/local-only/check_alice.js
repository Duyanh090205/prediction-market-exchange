// LOCAL-ONLY: ad-hoc lookup helper.

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run in production.");
  process.exit(1);
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] ?? "alice@test.com";
  const user = await prisma.user.findFirst({ where: { email } });
  console.log(user);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
