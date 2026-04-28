import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/health — DB connectivity + current UTC time
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", time: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { status: "error", time: new Date().toISOString() },
      { status: 503 }
    );
  }
}
