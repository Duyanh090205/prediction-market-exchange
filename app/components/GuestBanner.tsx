// The signed-out banner, shared by the market list and each market page.
//
// It has to describe what a visitor is actually getting. Before the
// /market-data namespace existed it claimed the book was live while the
// WebSocket handshake was being rejected three times in the console and the
// page never changed after load — a smaller claim would have been worth more
// than that one.

export default function GuestBanner() {
  return (
    <div
      style={{
        maxWidth: "1100px",
        margin: "1rem auto 0",
        padding: "0.75rem 1.25rem",
        background: "rgba(99,102,241,0.10)",
        border: "1px solid rgba(99,102,241,0.25)",
        borderRadius: "0.5rem",
        color: "#a5b4fc",
        fontSize: "0.875rem",
      }}
    >
      <p style={{ margin: 0 }}>
        Viewing as a guest — the book, prices and fills below update live.{" "}
        <a href="/login" style={{ color: "#c7d2fe" }}>
          Sign in or enter as a demo trader
        </a>{" "}
        to place orders.
      </p>
      <p
        style={{
          margin: "0.35rem 0 0",
          color: "#8888a0",
          fontSize: "0.8125rem",
          lineHeight: 1.5,
        }}
      >
        Guests get the public market-data feed, read-only. Order entry and
        position data require an authenticated session — the same split a real
        exchange runs.
      </p>
    </div>
  );
}
