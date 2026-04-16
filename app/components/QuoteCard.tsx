import TakeRequestForm from "./TakeRequestForm";
import QuoteActions from "./QuoteActions";

interface QuoteMaker {
  id: number;
  username: string;
  role: string;
}

interface TakeRequestStub {
  id: number;
}

interface Quote {
  id: number;
  bid: number;
  ask: number;
  size: number;
  status: string;
  maker: QuoteMaker;
  takeRequests: TakeRequestStub[];
}

interface QuoteCardProps {
  quote: Quote;
  contractId: number;
  currentUserId: number;
  currentUserRole: string;
  variant: "prominent" | "regular";
}

export default function QuoteCard({
  quote,
  contractId: _contractId,
  currentUserId,
  currentUserRole,
  variant,
}: QuoteCardProps) {
  const isOwner = quote.maker.id === currentUserId;
  const canTake =
    !isOwner &&
    currentUserRole !== "ADMIN" &&
    quote.status === "OPEN";
  const hasPendingRequests = quote.takeRequests.length > 0;

  if (variant === "prominent") {
    return (
      <div
        style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(129,140,248,0.04))",
          border: "1px solid rgba(99,102,241,0.35)",
          borderRadius: "0.75rem",
          padding: "1.5rem",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "1.25rem",
          }}
        >
          <div>
            <span
              style={{
                display: "inline-block",
                padding: "0.2rem 0.6rem",
                background: "rgba(245,158,11,0.12)",
                border: "1px solid rgba(245,158,11,0.25)",
                borderRadius: "0.25rem",
                fontSize: "0.6875rem",
                fontWeight: 700,
                color: "#f59e0b",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "0.5rem",
              }}
            >
              Primary Market
            </span>
            <p
              style={{
                margin: 0,
                fontSize: "0.875rem",
                color: "#8888a0",
              }}
            >
              by{" "}
              <strong style={{ color: "#e4e4ed" }}>{quote.maker.username}</strong>
            </p>
          </div>
          {hasPendingRequests && (
            <span
              style={{
                padding: "0.2rem 0.6rem",
                background: "rgba(245,158,11,0.1)",
                borderRadius: "0.25rem",
                fontSize: "0.6875rem",
                color: "#f59e0b",
                fontWeight: 600,
              }}
            >
              {hasPendingRequests ? `${quote.takeRequests.length} pending` : ""}
            </span>
          )}
        </div>

        {/* Bid / Ask */}
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <p
              style={{
                margin: "0 0 0.25rem",
                fontSize: "0.6875rem",
                color: "#22c55e",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Bid (Under)
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "2rem",
                fontWeight: 700,
                color: "#22c55e",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {quote.bid}
            </p>
          </div>

          <div
            style={{
              width: "1px",
              background: "#2a2a3e",
              alignSelf: "stretch",
            }}
          />

          <div style={{ flex: 1, textAlign: "center" }}>
            <p
              style={{
                margin: "0 0 0.25rem",
                fontSize: "0.6875rem",
                color: "#ef4444",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Ask (Over)
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "2rem",
                fontWeight: 700,
                color: "#ef4444",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {quote.ask}
            </p>
          </div>
        </div>

        {/* Size */}
        <div
          style={{
            textAlign: "center",
            padding: "0.5rem",
            background: "rgba(99,102,241,0.06)",
            borderRadius: "0.375rem",
            marginBottom: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.8125rem", color: "#8888a0" }}>
            Max size:{" "}
            <strong style={{ color: "#818cf8", fontSize: "1rem" }}>
              {quote.size}
            </strong>{" "}
            coins
          </span>
        </div>

        {/* Actions */}
        {canTake && (
          <TakeRequestForm
            quoteId={quote.id}
            quoteSize={quote.size}
            bid={quote.bid}
            ask={quote.ask}
          />
        )}
        {isOwner && (
          <QuoteActions
            quoteId={quote.id}
            currentBid={quote.bid}
            currentAsk={quote.ask}
            currentSize={quote.size}
            hasPendingRequests={hasPendingRequests}
          />
        )}
      </div>
    );
  }

  // Regular variant
  return (
    <div
      style={{
        background: "#12121a",
        border: "1px solid #2a2a3e",
        borderRadius: "0.5rem",
        padding: "1rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "#8888a0" }}>
          <strong style={{ color: "#e4e4ed" }}>{quote.maker.username}</strong>
        </p>
        {hasPendingRequests && (
          <span
            style={{
              padding: "0.15rem 0.5rem",
              background: "rgba(245,158,11,0.1)",
              borderRadius: "0.25rem",
              fontSize: "0.6875rem",
              color: "#f59e0b",
              fontWeight: 600,
            }}
          >
            {quote.takeRequests.length} pending
          </span>
        )}
      </div>

      {/* Bid / Ask / Size inline */}
      <div style={{ display: "flex", gap: "1rem", alignItems: "baseline", marginBottom: "0.75rem" }}>
        <span>
          <span
            style={{
              fontSize: "0.6875rem",
              color: "#22c55e",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginRight: "0.25rem",
            }}
          >
            B
          </span>
          <span style={{ fontSize: "1.125rem", fontWeight: 700, color: "#22c55e" }}>
            {quote.bid}
          </span>
        </span>
        <span style={{ color: "#2a2a3e" }}>/</span>
        <span>
          <span
            style={{
              fontSize: "0.6875rem",
              color: "#ef4444",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginRight: "0.25rem",
            }}
          >
            A
          </span>
          <span style={{ fontSize: "1.125rem", fontWeight: 700, color: "#ef4444" }}>
            {quote.ask}
          </span>
        </span>
        <span style={{ marginLeft: "auto", fontSize: "0.8125rem", color: "#5a5a72" }}>
          ×{" "}
          <strong style={{ color: "#818cf8" }}>{quote.size}</strong>
        </span>
      </div>

      {/* Actions */}
      {canTake && (
        <TakeRequestForm
          quoteId={quote.id}
          quoteSize={quote.size}
          bid={quote.bid}
          ask={quote.ask}
        />
      )}
      {isOwner && (
        <QuoteActions
          quoteId={quote.id}
          currentBid={quote.bid}
          currentAsk={quote.ask}
          currentSize={quote.size}
          hasPendingRequests={hasPendingRequests}
        />
      )}
    </div>
  );
}
