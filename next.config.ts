import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const basePath = process.env.TRADING_BASE_PATH || "";

// Production CSP — strict by default. `'unsafe-inline'` is removed from
// script-src; if you need third-party scripts later, generate a per-request
// nonce in middleware and add it here. Inline `style={...}` attributes are
// not affected by `style-src` (those are governed by `style-src-attr` which
// we deliberately don't lock down to keep React inline styles working).
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Dev CSP — keep `'unsafe-eval'` for Turbopack/HMR.
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
].join("; ");

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
      {
        key: "Content-Security-Policy",
        value: isProd ? PROD_CSP : DEV_CSP,
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
