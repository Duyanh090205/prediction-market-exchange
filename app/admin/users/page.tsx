"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  status: string;
  balance: number;
  createdAt: string;
  approvedAt: string | null;
}

const inputCss: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  background: "#0a0a0f",
  border: "1px solid #2a2a3e",
  borderRadius: "0.375rem",
  color: "#e4e4ed",
  fontSize: "0.875rem",
  boxSizing: "border-box",
};

const labelCss: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#8888a0",
  display: "block",
  marginBottom: "0.25rem",
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("USER");
  const [balance, setBalance] = useState("1000");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ tempPassword?: string; error?: string } | null>(null);

  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  const [busyUser, setBusyUser] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<Record<number, string>>({});

  const fetchUsers = useCallback(async () => {
    const r = await fetch(withTradingBasePath("/api/admin/users"));
    if (r.status === 403) {
      router.push("/");
      return;
    }
    const d = await r.json();
    setUsers(d.users ?? []);
  }, [router]);

  useEffect(() => {
    fetchUsers().finally(() => setLoading(false));
  }, [fetchUsers]);

  async function userAction(userId: number, body: Record<string, unknown>) {
    setBusyUser(userId);
    setActionMsg((m) => ({ ...m, [userId]: "" }));
    try {
      const res = await fetch(withTradingBasePath(`/api/admin/users/${userId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg((m) => ({ ...m, [userId]: data.error ?? "Failed" }));
      } else {
        await fetchUsers();
      }
    } finally {
      setBusyUser(null);
    }
  }

  async function approveUser(u: User) {
    const balStr = prompt(
      `Approve ${u.username}? Starting balance:`,
      "1000"
    );
    if (balStr == null) return;
    const balNum = parseInt(balStr, 10);
    if (isNaN(balNum) || balNum < 0) return;
    await userAction(u.id, { action: "approve", balance: balNum });
  }

  async function denyUser(u: User) {
    if (!confirm(`Deny and delete pending registration for ${u.username}?`)) return;
    await userAction(u.id, { action: "deny" });
  }

  async function suspendUser(u: User) {
    if (!confirm(`Suspend ${u.username}? They won't be able to log in.`)) return;
    await userAction(u.id, { action: "suspend" });
  }

  async function reactivateUser(u: User) {
    await userAction(u.id, { action: "reactivate" });
  }

  async function adjustBalance(u: User) {
    const deltaStr = prompt(`Adjust balance for ${u.username} (positive or negative integer):`);
    if (deltaStr == null) return;
    const delta = parseInt(deltaStr, 10);
    if (isNaN(delta) || delta === 0) return;
    const reason = prompt("Reason for the manual adjustment (visible in audit log + user notification):");
    if (!reason || reason.trim().length === 0) {
      setActionMsg((m) => ({ ...m, [u.id]: "Reason required" }));
      return;
    }
    await userAction(u.id, { action: "adjust_balance", delta, reason: reason.trim() });
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateResult(null);
    const res = await fetch(withTradingBasePath("/api/admin/users"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, role, balance: parseInt(balance, 10) }),
    });
    const data = await res.json();
    if (res.ok) {
      setCreateResult({ tempPassword: data.tempPassword });
      setUsername("");
      setEmail("");
      setRole("USER");
      setBalance("1000");
      await fetchUsers();
    } else {
      setCreateResult({ error: data.error });
    }
    setCreating(false);
  }

  async function generateReset(userId: number) {
    setResetUserId(userId);
    setResetLoading(true);
    setResetLink(null);
    const res = await fetch(withTradingBasePath("/api/admin/password-reset"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    setResetLink(res.ok ? data.resetLink : data.error);
    setResetLoading(false);
  }

  if (loading) return <p style={{ padding: "2rem", color: "#5a5a72" }}>Loading…</p>;

  const pending = users.filter((u) => u.status === "PENDING");
  const active = users.filter((u) => u.status === "ACTIVE");
  const suspended = users.filter((u) => u.status === "SUSPENDED");

  const statusBadge = (status: string) => {
    const colors: Record<string, { fg: string; bg: string }> = {
      PENDING: { fg: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
      ACTIVE: { fg: "#22c55e", bg: "rgba(34,197,94,0.12)" },
      SUSPENDED: { fg: "#ef4444", bg: "rgba(239,68,68,0.12)" },
    };
    const c = colors[status] ?? { fg: "#8888a0", bg: "rgba(136,136,160,0.1)" };
    return (
      <span
        style={{
          padding: "0.15rem 0.5rem",
          background: c.bg,
          borderRadius: "0.25rem",
          fontSize: "0.6875rem",
          color: c.fg,
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}
      >
        {status}
      </span>
    );
  };

  return (
    <main style={{ maxWidth: "1000px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <Link href="/admin" style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1rem" }}>
        ← Admin
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e4e4ed", marginBottom: "2rem" }}>
        User Management
      </h1>

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div style={{ marginBottom: "2rem", padding: "1.5rem", background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "0.75rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#f59e0b", marginBottom: "1rem" }}>
            Pending Approvals ({pending.length})
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td style={{ padding: "0.5rem 0.5rem 0.5rem 0", color: "#e4e4ed" }}>{u.username}</td>
                  <td style={{ padding: "0.5rem", color: "#8888a0", fontSize: "0.8125rem" }}>{u.email}</td>
                  <td style={{ padding: "0.5rem", color: "#5a5a72", fontSize: "0.75rem" }}>
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: "0.5rem", textAlign: "right" }}>
                    <button
                      onClick={() => approveUser(u)}
                      disabled={busyUser === u.id}
                      style={{
                        padding: "0.3rem 0.75rem",
                        background: "rgba(34,197,94,0.15)",
                        border: "1px solid rgba(34,197,94,0.35)",
                        borderRadius: "0.25rem",
                        color: "#22c55e",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        marginRight: "0.5rem",
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => denyUser(u)}
                      disabled={busyUser === u.id}
                      style={{
                        padding: "0.3rem 0.75rem",
                        background: "transparent",
                        border: "1px solid rgba(239,68,68,0.35)",
                        borderRadius: "0.25rem",
                        color: "#ef4444",
                        fontSize: "0.8125rem",
                        cursor: "pointer",
                      }}
                    >
                      Deny
                    </button>
                    {actionMsg[u.id] && (
                      <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#ef4444" }}>
                        {actionMsg[u.id]}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create user */}
      <div style={{ padding: "1.5rem", background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem", marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#e4e4ed", marginBottom: "1rem" }}>
          Create New User (skips approval queue)
        </h2>
        <form onSubmit={createUser} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={labelCss}>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required style={inputCss} />
          </div>
          <div>
            <label style={labelCss}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputCss} />
          </div>
          <div>
            <label style={labelCss}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={inputCss}>
              <option value="USER">USER</option>
              <option value="LIQUIDITY_PROVIDER">LIQUIDITY_PROVIDER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div>
            <label style={labelCss}>Starting Balance</label>
            <input type="number" value={balance} onChange={(e) => setBalance(e.target.value)} min={0} style={inputCss} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <button
              type="submit"
              disabled={creating}
              style={{
                padding: "0.625rem 1.5rem",
                background: "rgba(99,102,241,0.2)",
                border: "1px solid rgba(99,102,241,0.4)",
                borderRadius: "0.375rem",
                color: "#818cf8",
                fontWeight: 600,
                cursor: creating ? "not-allowed" : "pointer",
                fontSize: "0.9375rem",
              }}
            >
              {creating ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
        {createResult?.tempPassword && (
          <div style={{ marginTop: "1rem", padding: "1rem", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: "0.5rem" }}>
            <p style={{ margin: "0 0 0.25rem", color: "#22c55e", fontWeight: 600 }}>User created.</p>
            <p style={{ margin: 0, color: "#8888a0", fontSize: "0.875rem" }}>
              Temporary password: <code style={{ color: "#e4e4ed", background: "#0a0a0f", padding: "0.1rem 0.4rem", borderRadius: "0.25rem" }}>{createResult.tempPassword}</code>
            </p>
          </div>
        )}
        {createResult?.error && (
          <p style={{ marginTop: "0.75rem", color: "#ef4444", fontSize: "0.875rem" }}>{createResult.error}</p>
        )}
      </div>

      {/* Active + suspended */}
      <div style={{ background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Username", "Email", "Role", "Status", "Balance", "Actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0.75rem 1rem", fontSize: "0.6875rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #1a1a2e" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...active, ...suspended].map((u) => (
              <tr key={u.id}>
                <td style={{ padding: "0.75rem 1rem", color: "#e4e4ed", borderBottom: "1px solid #1a1a2e" }}>{u.username}</td>
                <td style={{ padding: "0.75rem 1rem", color: "#8888a0", fontSize: "0.875rem", borderBottom: "1px solid #1a1a2e" }}>{u.email}</td>
                <td style={{ padding: "0.75rem 1rem", color: "#5a5a72", fontSize: "0.8125rem", borderBottom: "1px solid #1a1a2e" }}>{u.role}</td>
                <td style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #1a1a2e" }}>{statusBadge(u.status)}</td>
                <td style={{ padding: "0.75rem 1rem", color: "#e4e4ed", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid #1a1a2e" }}>{u.balance.toLocaleString()}</td>
                <td style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #1a1a2e", fontSize: "0.8125rem" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-start" }}>
                    {u.status === "ACTIVE" && (
                      <>
                        <button
                          onClick={() => adjustBalance(u)}
                          disabled={busyUser === u.id}
                          style={{ color: "#818cf8", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: "0.8125rem" }}
                        >
                          Adjust balance
                        </button>
                        {u.role !== "ADMIN" && (
                          <button
                            onClick={() => suspendUser(u)}
                            disabled={busyUser === u.id}
                            style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: "0.8125rem" }}
                          >
                            Suspend
                          </button>
                        )}
                      </>
                    )}
                    {u.status === "SUSPENDED" && (
                      <button
                        onClick={() => reactivateUser(u)}
                        disabled={busyUser === u.id}
                        style={{ color: "#22c55e", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: "0.8125rem" }}
                      >
                        Reactivate
                      </button>
                    )}
                    <button
                      onClick={() => generateReset(u.id)}
                      disabled={resetLoading && resetUserId === u.id}
                      style={{ color: "#818cf8", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: "0.8125rem" }}
                    >
                      {resetLoading && resetUserId === u.id ? "…" : "Reset password"}
                    </button>
                  </div>
                  {resetUserId === u.id && resetLink && (
                    <input
                      readOnly
                      value={resetLink}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#8888a0", background: "#0a0a0f", border: "1px solid #2a2a3e", borderRadius: "0.25rem", padding: "0.25rem 0.5rem", width: "100%", boxSizing: "border-box" }}
                    />
                  )}
                  {actionMsg[u.id] && (
                    <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#ef4444" }}>
                      {actionMsg[u.id]}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
