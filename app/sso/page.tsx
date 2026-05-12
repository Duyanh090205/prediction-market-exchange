"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SsoPageInner() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const token = params.get("token");
      const callbackUrl = params.get("callbackUrl") || "/";
      if (!token) {
        setError("Missing SSO token.");
        return;
      }

      const result = await signIn("credentials", {
        ssoToken: token,
        callbackUrl,
        redirect: false,
      });

      if (result?.error) {
        setError("Unable to sign in with Lab SSO.");
        return;
      }

      if (result?.url) {
        window.location.assign(result.url);
      }
    };

    void run();
  }, [params]);

  const labUrl = process.env.NEXT_PUBLIC_LAB_LOGIN_URL || "https://lab.iterlight.com/login";

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", color: "#e4e4ed" }}>
        <h1 style={{ marginBottom: "0.75rem" }}>Signing in via IterLight Lab</h1>
        {error ? (
          <>
            <p style={{ opacity: 0.8, marginBottom: "1.25rem" }}>{error}</p>
            <a
              href={labUrl}
              style={{ color: "#818cf8", textDecoration: "none", fontSize: "0.875rem" }}
            >
              Return to IterLight Lab
            </a>
          </>
        ) : (
          <p style={{ opacity: 0.8 }}>Please wait while we complete your secure handoff.</p>
        )}
      </div>
    </main>
  );
}

export default function SsoPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Loading...</main>}>
      <SsoPageInner />
    </Suspense>
  );
}
