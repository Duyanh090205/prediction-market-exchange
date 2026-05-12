/**
 * Prefix same-origin paths for browser `fetch()` when the app uses Next.js `basePath`.
 * `NEXT_PUBLIC_TRADING_BASE_PATH` must match `TRADING_BASE_PATH` at build time.
 */
export function withTradingBasePath(path: string): string {
  const raw = process.env.NEXT_PUBLIC_TRADING_BASE_PATH || "";
  const base = raw.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
