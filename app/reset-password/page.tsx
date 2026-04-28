"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Reset failed");
      } else {
        setSuccess(true);
        setTimeout(() => router.push("/login"), 2000);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <p style={{ color: "#ef4444", textAlign: "center" }}>
        Invalid or missing reset token.
      </p>
    );
  }

  if (success) {
    return (
      <p style={{ color: "#22c55e", textAlign: "center" }}>
        Password reset successfully. Redirecting to login…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <label style={labelStyle}>New Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Confirm Password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          style={inputStyle}
        />
      </div>
      {error && <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>{error}</p>}
      <button type="submit" disabled={loading} style={btnStyle}>
        {loading ? "Resetting…" : "Reset Password"}
      </button>
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8125rem",
  color: "#8888a0",
  marginBottom: "0.375rem",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.625rem 0.75rem",
  background: "#0a0a0f",
  border: "1px solid #2a2a3e",
  borderRadius: "0.375rem",
  color: "#e4e4ed",
  fontSize: "0.9375rem",
  boxSizing: "border-box",
};
const btnStyle: React.CSSProperties = {
  padding: "0.75rem",
  background: "linear-gradient(135deg, #6366f1, #818cf8)",
  border: "none",
  borderRadius: "0.5rem",
  color: "#fff",
  fontSize: "0.9375rem",
  fontWeight: 600,
  cursor: "pointer",
};

export default function ResetPasswordPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "#0a0a0f",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          padding: "2rem",
          background: "#12121a",
          border: "1px solid #1a1a2e",
          borderRadius: "1rem",
        }}
      >
        <h1
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            color: "#e4e4ed",
            marginBottom: "1.5rem",
            textAlign: "center",
          }}
        >
          Reset Password
        </h1>
        <Suspense fallback={<p style={{ color: "#5a5a72" }}>Loading…</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
