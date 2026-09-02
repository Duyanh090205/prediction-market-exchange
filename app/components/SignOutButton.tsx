"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

// Sign out of THIS app first, then decide where to send the visitor.
//
// The previous version did neither: it only navigated to a hard-coded Lab
// login URL. On a standalone deployment that meant the session cookie survived
// the click — come back and you are still signed in — and the visitor was
// handed off to a host that has nothing to do with this deployment. Lab is only
// the auth source when Lab SSO is actually configured.
export default function SignOutButton() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // redirect:false so the Lab hop below is the only navigation.
        await signOut({ redirect: false });
        // Configured only on a Lab-mounted deployment, where the shared Lab
        // session has to be dropped too. Standalone lands on the market list,
        // which reads fine without an account.
        const labLogin = process.env.NEXT_PUBLIC_LAB_LOGIN_URL;
        window.location.assign(labLogin || "/");
      }}
      style={{
        padding: "0.375rem 0.875rem",
        background: "transparent",
        border: "1px solid #2a2a3e",
        borderRadius: "0.375rem",
        color: "#8888a0",
        fontSize: "0.8125rem",
        cursor: busy ? "default" : "pointer",
        transition: "all 0.15s",
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#6366f1";
        (e.currentTarget as HTMLButtonElement).style.color = "#e4e4ed";
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a2a3e";
        (e.currentTarget as HTMLButtonElement).style.color = "#8888a0";
      }}
    >
      {busy ? "Signing out…" : "Sign Out"}
    </button>
  );
}
