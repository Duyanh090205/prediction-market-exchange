import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// Default must match middleware.ts (which falls back to "/trading"). If these
// two disagree when TRADING_BASE_PATH is unset, every page redirect-loops at
// /trading/connect. Production sets TRADING_BASE_PATH explicitly, so this
// default only affects local runs without the env var.
const basePath = process.env.TRADING_BASE_PATH ?? "/trading";

// Content-Security-Policy is set per-request in middleware.ts — it needs a fresh
// nonce on every request so Next.js's own inline scripts can execute under a
// strict policy (no 'unsafe-inline'). A static CSP here previously used
// `script-src 'self'`, which blocked those inline scripts and produced blank
// pages in production.

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  async headers() {
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      },
    ];

    if (isProd) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    // Avoid breaking Auth.js session coordination / OAuth popup postMessage (see errors.authjs.dev COOP).
    securityHeaders.push({
      key: "Cross-Origin-Opener-Policy",
      value: "unsafe-none",
    });

    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
