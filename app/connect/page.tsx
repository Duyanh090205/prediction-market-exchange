"use client";

/**
 * Cookie bridge page — converts an existing Lab localStorage token into an
 * HTTP-only `lab_session` cookie so the trading-app middleware can verify it.
 *
 * Flow:
 *  1. Trading middleware: no lab_session cookie → redirect here with ?next=<dest>
 *  2. This page reads the Lab accessToken from localStorage.
 *  3. Calls POST /api/auth/session-cookie on the Lab backend (same origin, so
 *     Set-Cookie is accepted by the browser).
 *  4. Navigates to <dest> — the middleware now sees the cookie and lets through.
 *  5. If no Lab token exists, sends the user to Lab login so they can sign in
 *     (the Lab login page will redirect back to <dest> after auth).
 */

import { useEffect, useState } from "react";

const LAB_API_URL =
  process.env.NEXT_PUBLIC_LAB_API_URL || "https://lab.iterlight.com/api";
const LAB_LOGIN_URL =
  process.env.NEXT_PUBLIC_LAB_LOGIN_URL || "https://lab.iterlight.com/login";

export default function ConnectPage() {
  const [status, setStatus] = useState<"working" | "error">("working");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || "/trading";

    async function syncCookie() {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("accessToken")
          : null;

      if (!token) {
        // Not logged in to Lab at all — send to Lab login
        window.location.assign(
          `${LAB_LOGIN_URL}?redirect=${encodeURIComponent(next)}&reason=no_local_token`
        );
        return;
      }

      try {
        const res = await fetch(`${LAB_API_URL}/auth/session-cookie`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include", // ensure Set-Cookie header is applied
        });

        if (res.ok) {
          // Cookie is now set — navigate to the original destination
          window.location.assign(next);
        } else if (res.status === 401) {
          // Lab token is expired — clear it and send to login
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
          window.location.assign(
            `${LAB_LOGIN_URL}?redirect=${encodeURIComponent(next)}&reason=session_cookie_401`
          );
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    }

    syncCookie();
  }, []);

  if (status === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 text-slate-700">
        <p className="text-sm">
          Could not connect to IterLight Lab. Please try again.
        </p>
        <a
          href={LAB_LOGIN_URL}
          className="text-sm text-emerald-600 underline underline-offset-2"
        >
          Return to Lab login
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-sm text-slate-500 animate-pulse">
        Connecting to IterLight Lab…
      </p>
    </div>
  );
}
