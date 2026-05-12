"use client";

/**
 * Public bridge: same origin as Lab (lab.iterlight.com), so we read Lab JWT from
 * localStorage and exchange it for a trading NextAuth session via SSO URL — no second login.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const BASE_PATH = process.env.NEXT_PUBLIC_TRADING_BASE_PATH || "/trading";

function AuthFromLabInner() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const nextPath = searchParams.get("next") || "/";
      const token =
        typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;

      if (!token) {
        // No Lab session — fall back to the trading app's own Google login
        const tradingLogin = `${window.location.origin}${BASE_PATH}/login?callbackUrl=${encodeURIComponent(nextPath)}`;
        window.location.assign(tradingLogin);
        return;
      }

      const apiBase =
        process.env.NEXT_PUBLIC_LAB_API_URL || `${window.location.origin}/api`;

      const res = await fetch(
        `${apiBase}/lab/trading/sso-url?callbackUrl=${encodeURIComponent(nextPath)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
          // Lab session expired — fall back to trading app's own Google login
          const tradingLogin = `${window.location.origin}${BASE_PATH}/login?callbackUrl=${encodeURIComponent(nextPath)}`;
          window.location.assign(tradingLogin);
          return;
        }
        setError(body.message || body.error || "Could not start Lab SSO handoff.");
        return;
      }

      const ssoUrl = body.data?.ssoUrl ?? body.ssoUrl;
      if (typeof ssoUrl === "string" && ssoUrl.length > 0) {
        window.location.assign(ssoUrl);
        return;
      }

      setError("Lab SSO did not return a handoff URL.");
    };

    void run().catch(() =>
      setError("Something went wrong connecting to IterLight Lab.")
    );
  }, [searchParams]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", color: "#e4e4ed", maxWidth: "28rem", padding: "1rem" }}>
        <h1 style={{ marginBottom: "0.75rem", fontSize: "1.25rem" }}>
          Connecting to IterLight Lab…
        </h1>
        {error ? (
          <p style={{ opacity: 0.85 }}>{error}</p>
        ) : (
          <p style={{ opacity: 0.75 }}>Using your Lab sign-in — no extra password.</p>
        )}
      </div>
    </main>
  );
}

export default function AuthFromLabPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
          <p style={{ color: "#8888a0" }}>Loading…</p>
        </main>
      }
    >
      <AuthFromLabInner />
    </Suspense>
  );
}
