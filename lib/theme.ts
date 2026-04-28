// Visual conventions for binary spread bets.
//
// OVER  → red (#ef4444)   — taker wins if settlement > strike
// UNDER → green (#22c55e) — taker wins if settlement < strike
//
// These constants are the single source of truth — any UI showing a side
// MUST import from here. The asymmetry is intentional: it mirrors the
// "ask/buy higher = OVER" convention on the Primary Market quote layout.

export interface SideColor {
  fg: string;
  bg: string;
  border: string;
}

export const SIDE_COLORS: Record<"OVER" | "UNDER", SideColor> = {
  OVER: {
    fg: "#ef4444",
    bg: "rgba(239,68,68,0.1)",
    border: "rgba(239,68,68,0.3)",
  },
  UNDER: {
    fg: "#22c55e",
    bg: "rgba(34,197,94,0.1)",
    border: "rgba(34,197,94,0.3)",
  },
};

export function sideColor(side: "OVER" | "UNDER"): SideColor {
  return SIDE_COLORS[side];
}
