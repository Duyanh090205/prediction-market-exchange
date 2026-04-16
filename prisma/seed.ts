/**
 * Seed script — creates Sam (LIQUIDITY_PROVIDER) and Admin (ADMIN).
 * All other users register themselves via /register.
 *
 * Safe to run multiple times (upsert — skips if user already exists).
 *
 * Override default emails with env vars:
 *   SAM_EMAIL=sam@yourdomain.com ADMIN_EMAIL=admin@yourdomain.com npx prisma db seed
 */

import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function generatePassword(): string {
  const chars =
    "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  return Array.from(
    { length: 12 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

interface SeedUser {
  username: string;
  email: string;
  role: Role;
  balance: number;
}

const SEED_USERS: SeedUser[] = [
  {
    username: "sam",
    email: process.env.SAM_EMAIL ?? "sam@iterlight.com",
    role: Role.LIQUIDITY_PROVIDER,
    balance: 10000,
  },
  {
    username: "admin",
    email: process.env.ADMIN_EMAIL ?? "admin@iterlight.com",
    role: Role.ADMIN,
    balance: 1000,
  },
  {
    username: "ivan",
    email: process.env.IVAN_EMAIL ?? "ivan@iterlight.com",
    role: Role.USER,
    balance: 1000,
  },
  {
    username: "james",
    email: process.env.JAMES_EMAIL ?? "james@iterlight.com",
    role: Role.USER,
    balance: 1000,
  },
  {
    username: "thy",
    email: process.env.THY_EMAIL ?? "thy@iterlight.com",
    role: Role.USER,
    balance: 1000,
  },
  {
    username: "khang",
    email: process.env.KHANG_EMAIL ?? "khang@iterlight.com",
    role: Role.USER,
    balance: 1000,
  },
  {
    username: "hieu",
    email: process.env.HIEU_EMAIL ?? "hieu@iterlight.com",
    role: Role.USER,
    balance: 1000,
  },
];

async function main() {
  console.log("\n=== Trading Game Platform — Seed ===\n");

  for (const userData of SEED_USERS) {
    // Check if user already exists (by email OR username)
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: userData.email }, { username: userData.username }],
      },
    });

    if (existing) {
      console.log(
        `↩  Skipped  ${userData.username.padEnd(8)} (already exists — id: ${existing.id})`
      );
      continue;
    }

    const password = generatePassword();
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: userData.username,
          email: userData.email,
          hashedPassword,
          balance: userData.balance,
          role: userData.role,
        },
      });

      await tx.balanceLedger.create({
        data: {
          userId: newUser.id,
          delta: userData.balance,
          balanceAfter: userData.balance,
          eventType: "INITIAL_SEED",
          initiatedBy: 0, // system
          note: "Initial seed",
        },
      });

      return newUser;
    });

    console.log(
      `✓  Created  ${userData.username.padEnd(8)} (${userData.role}) — id: ${user.id} — password: ${password}`
    );
  }

  console.log(
    "\nStore these passwords now — they cannot be retrieved again.\n"
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
