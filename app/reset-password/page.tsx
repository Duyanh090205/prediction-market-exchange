// Server wrapper. The client UI lives in ResetPasswordClient.tsx.
//
// This file exists only to force per-request rendering. middleware.ts issues a
// fresh CSP nonce per request, and Next can stamp that nonce onto its script
// tags only while rendering a request. Prerendered at build time the page ships
// unnonced scripts, 'strict-dynamic' blocks every one of them, hydration never
// runs, and the page sits on its Suspense fallback forever.
//
// Route segment config is ignored inside a "use client" file, which is why the
// component had to be split out rather than annotated in place.
export const dynamic = "force-dynamic";

import ResetPasswordClient from "./ResetPasswordClient";

export default function Page() {
  return <ResetPasswordClient />;
}
