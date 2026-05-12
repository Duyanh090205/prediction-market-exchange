"use client";

export default function SignOutButton() {
  return (
    <button
      onClick={() => {
        // Lab is the auth source — redirect there to sign out globally
        window.location.assign(
          `${process.env.NEXT_PUBLIC_LAB_LOGIN_URL || "https://lab.iterlight.com/login"}`
        );
      }}
      style={{
        padding: "0.375rem 0.875rem",
        background: "transparent",
        border: "1px solid #2a2a3e",
        borderRadius: "0.375rem",
        color: "#8888a0",
        fontSize: "0.8125rem",
        cursor: "pointer",
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
      Sign Out
    </button>
  );
}
