"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

// Sign out, then land on the market list.
//
// An earlier version only navigated to an external login page and never
// called signOut(): the session cookie survived the click, so a visitor who
// signed out was still signed in when they came back.
export default function SignOutButton() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // redirect:false so the assign() below is the only navigation.
        await signOut({ redirect: false });
        // The market list reads fine without an account.
        window.location.assign("/");
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
