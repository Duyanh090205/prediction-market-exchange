"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";


interface Contract {
  id: number;
  title: string;
  description: string;
  status: string;
  settlementValue: number | null;
  _count: { trades: number };
  createdAt: string;
}

export default function AdminContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  // Settle form
  const [settling, setSettling] = useState<number | null>(null);
  const [settlementValue, setSettlementValue] = useState("");
  const [settleMsg, setSettleMsg] = useState<Record<number, string>>({});

  // Create contract form removed (now in /markets/create)

  const fetchContracts = useCallback(async () => {
    const res = await fetch("/api/contracts?all=1");
    if (res.ok) {
      const d = await res.json();
      setContracts(d.contracts ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchContracts(); }, [fetchContracts]);

  // createContract function removed

  async function settleContract(contractId: number) {
    const val = parseInt(settlementValue, 10);
    if (isNaN(val)) {
      setSettleMsg((m) => ({ ...m, [contractId]: "Enter a valid integer" }));
      return;
    }
    const res = await fetch(`/api/contracts/${contractId}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settlementValue: val }),
    });
    const data = await res.json();
    if (res.ok) {
      setSettleMsg((m) => ({ ...m, [contractId]: `Settled at ${val}` }));
      setSettling(null);
      fetchContracts();
    } else {
      setSettleMsg((m) => ({ ...m, [contractId]: data.error ?? "Failed" }));
    }
  }

  if (loading) return <p style={{ padding: "2rem", color: "#5a5a72" }}>Loading…</p>;

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <Link href="/admin" style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1rem" }}>
        ← Admin
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e4e4ed", marginBottom: "2rem" }}>
        Contract Management
      </h1>



      {/* Contract list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {contracts.map((c) => (
          <div key={c.id} style={{ padding: "1.25rem 1.5rem", background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div>
                <Link href={`/markets/${c.id}`} style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#818cf8", textDecoration: "none" }}>
                  {c.title}
                </Link>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#5a5a72" }}>
                  {c.description}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: c.status === "OPEN" ? "#22c55e" : "#8888a0", padding: "0.2rem 0.5rem", background: c.status === "OPEN" ? "rgba(34,197,94,0.1)" : "rgba(136,136,160,0.1)", borderRadius: "0.25rem" }}>
                  {c.status}
                </span>
                <span style={{ fontSize: "0.8125rem", color: "#5a5a72" }}>
                  {c._count.trades} trades
                </span>
              </div>
            </div>

            {c.status === "SETTLED" && c.settlementValue != null && (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "#818cf8" }}>
                Settlement value: {c.settlementValue}
              </p>
            )}

            {c.status === "OPEN" && (
              <div style={{ marginTop: "0.75rem" }}>
                {settling === c.id ? (
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="number"
                      placeholder="Settlement value"
                      value={settlementValue}
                      onChange={(e) => setSettlementValue(e.target.value)}
                      style={{ padding: "0.4rem 0.625rem", background: "#0a0a0f", border: "1px solid #2a2a3e", borderRadius: "0.25rem", color: "#e4e4ed", fontSize: "0.875rem", width: "160px" }}
                    />
                    <button onClick={() => settleContract(c.id)} style={{ padding: "0.4rem 1rem", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "0.25rem", color: "#ef4444", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer" }}>
                      Confirm Settle
                    </button>
                    <button onClick={() => setSettling(null)} style={{ padding: "0.4rem 0.75rem", background: "transparent", border: "1px solid #2a2a3e", borderRadius: "0.25rem", color: "#5a5a72", fontSize: "0.8125rem", cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setSettling(c.id); setSettlementValue(""); }} style={{ padding: "0.4rem 1rem", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "0.25rem", color: "#ef4444", fontSize: "0.8125rem", cursor: "pointer" }}>
                    Settle Contract
                  </button>
                )}
                {settleMsg[c.id] && (
                  <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#818cf8" }}>{settleMsg[c.id]}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
