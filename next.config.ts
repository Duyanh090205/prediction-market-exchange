import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// Must match the default in middleware.ts. Standalone deployments serve at the
// domain root, so the default is empty. Set TRADING_BASE_PATH=/trading only when
// mounting this app under a path prefix (its original Lab layout).
const basePath = process.env.TRADING_BASE_PATH ?? "";

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
