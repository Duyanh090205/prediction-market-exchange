import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import ContractCard from "@/app/components/ContractCard";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const contracts = await prisma.contract.findMany({
    where: { status: "OPEN" },
    include: {
      quotes: {
        where: { status: "OPEN" },
        select: { id: true, status: true },
      },
      _count: { select: { trades: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const isAdmin = session.user.role === "ADMIN";

  return (
    <>
      <Navbar />
      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: "2rem",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                color: "#e4e4ed",
                margin: "0 0 0.25rem",
              }}
            >
              Open Markets
            </h1>
            <p style={{ margin: 0, fontSize: "0.9375rem", color: "#8888a0" }}>
              {contracts.length === 0
                ? "No markets open yet."
                : `${contracts.length} active ${contracts.length === 1 ? "market" : "markets"}`}
            </p>
          </div>

          {isAdmin && (
            <Link
              href="/admin/contracts/new"
              style={{
                padding: "0.5rem 1.25rem",
                background: "#6366f1",
                color: "#fff",
                borderRadius: "0.375rem",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              + New Contract
            </Link>
          )}
        </div>

        {/* Contracts grid */}
        {contracts.length === 0 ? (
          <div
            style={{
              padding: "3rem",
              textAlign: "center",
              background: "#12121a",
              border: "1px dashed #2a2a3e",
              borderRadius: "0.75rem",
            }}
          >
            <p style={{ color: "#5a5a72", fontSize: "1rem", margin: 0 }}>
              {isAdmin
                ? "No contracts yet. Create the first one to get started."
                : "No markets open yet. Check back soon."}
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "1.25rem",
            }}
          >
            {contracts.map((c: (typeof contracts)[number]) => (
              <ContractCard key={c.id} contract={c} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
