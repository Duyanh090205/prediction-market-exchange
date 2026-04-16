"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Registration failed.");
        return;
      }

      router.push("/login?registered=1");
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.75rem 1rem",
    background: "#0a0a0f",
    border: "1px solid #2a2a3e",
    borderRadius: "0.5rem",
    color: "#e4e4ed",
    fontSize: "1rem",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.875rem",
    color: "#8888a0",
    marginBottom: "0.5rem",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          padding: "2.5rem",
          background: "#12121a",
          borderRadius: "1rem",
          border: "1px solid #2a2a3e",
        }}
      >
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            marginBottom: "0.5rem",
            textAlign: "center",
            background: "linear-gradient(135deg, #6366f1, #818cf8)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Create Account
        </h1>
        <p
          style={{
            textAlign: "center",
            color: "#8888a0",
            marginBottom: "2rem",
            fontSize: "0.875rem",
          }}
        >
          Trading Game Platform
        </p>

        {error && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "0.5rem",
              color: "#ef4444",
              fontSize: "0.875rem",
              marginBottom: "1.5rem",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
              style={inputStyle}
              placeholder="e.g. ivan"
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "1.75rem" }}>
            <label style={labelStyle}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              style={inputStyle}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: loading ? "#4f46e5" : "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
              transition: "all 0.2s",
            }}
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p
          style={{
            textAlign: "center",
            marginTop: "1.5rem",
            fontSize: "0.875rem",
            color: "#8888a0",
          }}
        >
          Already have an account?{" "}
          <Link
            href="/login"
            style={{ color: "#818cf8", textDecoration: "none" }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
