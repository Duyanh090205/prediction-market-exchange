"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
    handleGoogleCredential?: (response: { credential: string }) => void;
  }
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError("Google Sign-In is not configured.");
      return;
    }

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
      if (result?.url) {
        window.location.assign(result.url);
      }
    };

    const initGSI = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: window.handleGoogleCredential,
        auto_select: true,
      });
      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          width: buttonRef.current.offsetWidth || 320,
          text: "signin_with",
          shape: "pill",
        });
      }
      window.google.accounts.id.prompt();
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
  }, [callbackUrl]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)",
        fontFamily: "system-ui, sans-serif",
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
        <div
          style={{
            width: "3rem",
            height: "3rem",
            borderRadius: "0.75rem",
            background: "rgba(99,102,241,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1.25rem",
            fontSize: "1.5rem",
          }}
        >
          📈
        </div>

        <h1
          style={{
            color: "#e4e4ed",
            fontSize: "1.375rem",
            fontWeight: 600,
            margin: "0 0 0.375rem",
          }}
        >
          Trading Platform
        </h1>
        <p style={{ color: "#8888a0", fontSize: "0.9rem", margin: "0 0 2rem" }}>
          Sign in with your IterLight account to continue.
        </p>

        {loading ? (
          <p style={{ color: "#8888a0", fontSize: "0.875rem" }}>Signing in…</p>
        ) : (
          <div ref={buttonRef} style={{ display: "flex", justifyContent: "center" }} />
        )}

        {error && (
          <p
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

        <p
          style={{
            marginTop: "1.75rem",
            color: "#555570",
            fontSize: "0.75rem",
            lineHeight: 1.5,
          }}
        >
          Access is limited to IterLight Lab members.
          <br />
          Use the same Google account as your Lab login.
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
