"use client";


import { Suspense, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
    handleGoogleCredential?: (response: { credential: string }) => void;
  }
}

const input: React.CSSProperties = {
  width: "100%",
  marginTop: "0.375rem",
  padding: "0.625rem 0.75rem",
  borderRadius: "0.5rem",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  color: "#e4e4ed",
  fontSize: "0.9rem",
  fontFamily: "inherit",
};

const label: React.CSSProperties = {
  display: "block",
  textAlign: "left",
  color: "#8888a0",
  fontSize: "0.8125rem",
};

function LoginPageInner() {
  const searchParams = useSearchParams();
  const callbackUrl =
    searchParams.get("callbackUrl") || searchParams.get("next") || "/";
  const buttonRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  // Google Sign-In is optional and only rendered when a client id is set. The
  // password form below is always present, and is what a standalone deployment
  // runs on — the credentials provider in auth.ts has never gone away.
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!googleClientId) return;

    window.handleGoogleCredential = async ({ credential }: { credential: string }) => {
      setLoading(true);
      setError(null);
      const result = await signIn("credentials", {
        googleIdToken: credential,
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setError("Sign-in failed. Please try again.");
        setLoading(false);
        return;
      }
      window.location.assign(result?.url || callbackUrl);
    };

    const initGSI = () => {
      if (!window.google?.accounts?.id || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: window.handleGoogleCredential,
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
      });
    };

    if (window.google?.accounts?.id) {
      initGSI();
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = initGSI;
      document.head.appendChild(script);
    }

    return () => {
      window.handleGoogleCredential = undefined;
    };
  }, [googleClientId, callbackUrl]);

  // "Enter as demo trader": mint a throwaway sandbox account, then sign in with
  // its credentials through the same provider the password form uses. The
  // server never gets a second way to create a session — see
  // lib/demoAccounts.ts for the cap, the TTL and what a demo account may not do.
  async function onDemo() {
    setError(null);
    setDemoLoading(true);
    try {
      const res = await fetch(withTradingBasePath("/api/demo/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not start a demo session.");
        setDemoLoading(false);
        return;
      }
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });
      if (!result || result.error) {
        setError("Demo account was created but sign-in failed.");
        setDemoLoading(false);
        return;
      }
      window.location.assign(data.redirectTo || callbackUrl);
    } catch {
      setError("Could not start a demo session.");
      setDemoLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (!result || result.error) {
      setError("Those credentials were not accepted.");
      setLoading(false);
      return;
    }
    window.location.assign(callbackUrl);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)",
        fontFamily: "system-ui, sans-serif",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          textAlign: "center",
          padding: "2.5rem",
          maxWidth: "24rem",
          width: "100%",
          background: "rgba(255,255,255,0.04)",
          borderRadius: "1.5rem",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <h1
          style={{
            color: "#e4e4ed",
            fontSize: "1.375rem",
            fontWeight: 600,
            margin: "0 0 0.375rem",
          }}
        >
          Sign in
        </h1>
        <p style={{ color: "#8888a0", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          Or{" "}
          <Link href="/" style={{ color: "#a5b4fc" }}>
            read the markets
          </Link>{" "}
          without an account.
        </p>

        <button
          type="button"
          onClick={onDemo}
          disabled={demoLoading || loading}
          style={{
            width: "100%",
            padding: "0.625rem",
            borderRadius: "0.5rem",
            border: "1px solid rgba(99,102,241,0.5)",
            background: demoLoading ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.16)",
            color: "#c7d2fe",
            fontSize: "0.9rem",
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: demoLoading ? "default" : "pointer",
          }}
        >
          {demoLoading ? "Opening a demo account…" : "Enter as demo trader"}
        </button>
        <p
          style={{
            color: "#555570",
            fontSize: "0.75rem",
            margin: "0.5rem 0 0",
            lineHeight: 1.5,
          }}
        >
          A sandbox account with play money, against the real matching engine.
          No email, no approval. It expires after 24 hours.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            margin: "1.5rem 0",
            color: "#555570",
            fontSize: "0.75rem",
          }}
        >
          <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
          or sign in
          <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem" }}>
          <div>
            <label htmlFor="email" style={label}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={input}
            />
          </div>

          <div>
            <label htmlFor="password" style={label}>
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={input}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.625rem",
              borderRadius: "0.5rem",
              border: "none",
              background: loading ? "rgba(99,102,241,0.4)" : "rgb(99,102,241)",
              color: "#fff",
              fontSize: "0.9rem",
              fontFamily: "inherit",
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {googleClientId && (
          <div
            ref={buttonRef}
            style={{ display: "flex", justifyContent: "center", marginTop: "1rem" }}
          />
        )}

        {error && (
          <p
            role="alert"
            style={{
              color: "#f87171",
              fontSize: "0.8125rem",
              marginTop: "1rem",
              padding: "0.625rem 1rem",
              background: "rgba(248,113,113,0.1)",
              borderRadius: "0.5rem",
            }}
          >
            {error}
          </p>
        )}

        <p style={{ marginTop: "1.75rem", color: "#555570", fontSize: "0.75rem" }}>
          No account?{" "}
          <a href="/register" style={{ color: "#8888a0" }}>
            Register
          </a>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
          <p style={{ color: "#8888a0" }}>Loading…</p>
        </main>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
