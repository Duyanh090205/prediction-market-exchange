// Instant skeleton shown while the (dynamic, server-rendered) Positions page
// fetches — so tapping "Positions" gives immediate feedback instead of a blank
// wait. Keeps a nav-height bar so the layout doesn't jump.

export default function LoadingPositions() {
  const card: React.CSSProperties = {
    height: "5.5rem",
    background: "#12121a",
    border: "1px solid #1a1a2e",
    borderRadius: "0.75rem",
    marginBottom: "1rem",
  };

  return (
    <>
      <div
        style={{
          minHeight: "3.5rem",
          background: "rgba(18,18,26,0.92)",
          borderBottom: "1px solid #2a2a3e",
        }}
      />
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ height: "1.5rem", width: "180px", background: "#1a1a2e", borderRadius: "0.375rem", marginBottom: "0.75rem" }} />
        <div style={{ height: "0.875rem", width: "320px", background: "#15151f", borderRadius: "0.375rem", marginBottom: "2rem" }} />
        <div style={{ height: "0.75rem", width: "90px", background: "#1a1a2e", borderRadius: "0.375rem", marginBottom: "1rem" }} />
        <div style={card} />
        <div style={card} />
        <div style={{ ...card, opacity: 0.6 }} />
        <p style={{ color: "#5a5a72", fontSize: "0.8125rem", textAlign: "center", marginTop: "1.5rem" }}>
          Loading positions…
        </p>
      </main>
    </>
  );
}
