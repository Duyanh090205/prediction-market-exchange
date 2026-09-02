"use client";

import Link from "next/link";

interface Quote {
  id: number;
  status: string;
}

interface ContractCardProps {
  contract: {
    id: number;
    title: string;
    description: string;
    status: string;
    createdAt: string | Date;
    settlesAt?: string | Date | null;
    settledAt?: string | Date | null;
    settlementValue?: number | null;
    quotes: Quote[];
    _count: { trades: number };
  };
}

// Fixed locale on both sides of hydration — an unqualified toLocaleDateString()
// formats differently on the server than in the visitor's browser.
function day(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ContractCard({ contract }: ContractCardProps) {
  const openQuotes = contract.quotes.filter((q) => q.status === "OPEN").length;
  const settled = contract.status === "SETTLED";

  return (
    <div
      style={{
        background: "#12121a",
        border: "1px solid #2a2a3e",
        borderRadius: "0.75rem",
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        transition: "border-color 0.15s",
      }}
      onMouseOver={(e) =>
        ((e.currentTarget as HTMLDivElement).style.borderColor = "#6366f1")
      }
      onMouseOut={(e) =>
        ((e.currentTarget as HTMLDivElement).style.borderColor = "#2a2a3e")
      }
    >
      {/* Title */}
      <h2
        style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          color: "#e4e4ed",
          margin: 0,
          lineHeight: 1.3,
        }}
      >
        {contract.title}
      </h2>

      {/* When it settles, or what it settled at. A market with neither reads as
          open ended, which is the one thing a real venue never leaves unsaid. */}
      {settled ? (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "#f59e0b", fontWeight: 600 }}>
          Settled at {contract.settlementValue}
          {contract.settledAt ? (
            <span style={{ color: "#5a5a72", fontWeight: 400 }}> · {day(contract.settledAt)}</span>
          ) : null}
        </p>
      ) : contract.settlesAt ? (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "#5a5a72" }}>
          Settles <span style={{ color: "#818cf8", fontWeight: 600 }}>{day(contract.settlesAt)}</span>
        </p>
      ) : null}

      {/* Description — 2 lines max */}
      <p
        style={{
          fontSize: "0.875rem",
          color: "#8888a0",
          margin: 0,
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {contract.description}
      </p>

      {/* Stats */}
      <div style={{ display: "flex", gap: "1.25rem" }}>
        {!settled && (
          <span style={{ fontSize: "0.8125rem", color: "#5a5a72" }}>
            <span style={{ color: "#818cf8", fontWeight: 600 }}>{openQuotes}</span>{" "}
            open {openQuotes === 1 ? "quote" : "quotes"}
          </span>
        )}
        <span style={{ fontSize: "0.8125rem", color: "#5a5a72" }}>
          <span style={{ color: "#818cf8", fontWeight: 600 }}>
            {contract._count.trades}
          </span>{" "}
          {contract._count.trades === 1 ? "trade" : "trades"}
        </span>
      </div>

      {/* CTA */}
      <Link
        href={`/markets/${contract.id}`}
        style={{
          display: "inline-block",
          marginTop: "0.25rem",
          padding: "0.5rem 1.25rem",
          background: settled ? "#2a2a3e" : "#6366f1",
          color: "#fff",
          borderRadius: "0.375rem",
          textDecoration: "none",
          fontSize: "0.875rem",
          fontWeight: 600,
          alignSelf: "flex-start",
          transition: "background 0.15s",
        }}
        onMouseOver={(e) =>
          ((e.currentTarget as HTMLAnchorElement).style.background = settled ? "#3a3a52" : "#818cf8")
        }
        onMouseOut={(e) =>
          ((e.currentTarget as HTMLAnchorElement).style.background = settled ? "#2a2a3e" : "#6366f1")
        }
      >
        {settled ? "View settlement →" : "View Market →"}
      </Link>
    </div>
  );
}
