import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import ChatPanel from "@/app/components/ChatPanel";

export const dynamic = "force-dynamic";

// Global lobby chat (#8) — a single room everyone can talk in, separate from the
// per-market chats on each contract page.
export default async function LobbyChatPage() {
  const user = await getLabUser();
  if (!user) redirect("/login");

  const rows = await prisma.message.findMany({
    where: { contractId: null, recipientId: null }, // lobby only — exclude DMs
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const messages = rows.reverse().map((m) => ({
    id: m.id,
    contractId: m.contractId,
    recipientId: m.recipientId,
    userId: m.userId,
    username: m.user.username,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <>
      <Navbar />
      <main style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <Link href="/" style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1rem" }}>
          ← Markets
        </Link>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e4e4ed", margin: "0 0 0.25rem" }}>Lobby</h1>
        <p style={{ color: "#5a5a72", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
          Chat with everyone in the game. (Each market also has its own chat.)
        </p>
        <ChatPanel contractId={null} currentUserId={Number(user.id)} initialMessages={messages} />
      </main>
    </>
  );
}
