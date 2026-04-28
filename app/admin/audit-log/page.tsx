"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Entry {
  id: number;
  adminId: number;
  action: string;
  targetType: string | null;
  targetId: number | null;
  targetUserId: number | null;
  metadata: unknown;
  ipAddress: string | null;
  note: string;
  createdAt: string;
}

const ACTIONS = [
  "",
  "CREATE_USER",
  "APPROVE_USER",
  "DENY_USER",
  "SUSPEND_USER",
  "REACTIVATE_USER",
  "ADJUST_BALANCE",
  "GENERATE_RESET_TOKEN",
  "PASSWORD_RESET",
  "SETTLE_CONTRACT",
  "DELETE_CONTRACT",
  "DELETE_QUOTE",
  "DELETE_TRADE",
  "CANCEL_QUOTE",
];

export default function AdminAuditLogPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const url = action ? `/api/admin/audit-log?action=${action}` : "/api/admin/audit-log";
    fetch(url)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .finally(() => setLoading(false));
  }, [action]);

  return (
    <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <Link href="/admin" style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1rem" }}>
        ← Admin
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e4e4ed", marginBottom: "1rem" }}>
        Audit Log
      </h1>

      <div style={{ marginBottom: "1.5rem" }}>
        <label style={{ fontSize: "0.8125rem", color: "#8888a0", marginRight: "0.5rem" }}>Filter by action:</label>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          style={{
            padding: "0.4rem 0.75rem",
            background: "#0a0a0f",
            border: "1px solid #2a2a3e",
            borderRadius: "0.375rem",
            color: "#e4e4ed",
            fontSize: "0.875rem",
          }}
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a || "ALL"}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p style={{ color: "#5a5a72" }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: "#5a5a72" }}>No entries.</p>
      ) : (
        <div style={{ background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                {["When", "Admin", "Action", "Target", "IP", "Note"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "0.6rem 0.75rem",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      color: "#5a5a72",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      borderBottom: "1px solid #1a1a2e",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#5a5a72", whiteSpace: "nowrap", borderBottom: "1px solid #1a1a2e" }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#8888a0", borderBottom: "1px solid #1a1a2e" }}>
                    #{e.adminId}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#818cf8", fontWeight: 600, borderBottom: "1px solid #1a1a2e" }}>
                    {e.action}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#8888a0", borderBottom: "1px solid #1a1a2e" }}>
                    {e.targetType ? `${e.targetType}${e.targetId ? `#${e.targetId}` : ""}` : e.targetUserId ? `User#${e.targetUserId}` : "—"}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#5a5a72", fontFamily: "ui-monospace, monospace", fontSize: "0.75rem", borderBottom: "1px solid #1a1a2e" }}>
                    {e.ipAddress ?? "—"}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#e4e4ed", borderBottom: "1px solid #1a1a2e" }}>
                    {e.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
