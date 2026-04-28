// P&L calculator — binary spread betting per Section 4 of plan

export interface PnlResult {
  takerPnl: number;
  makerPnl: number;
}

/**
 * Calculate P&L for both sides of a confirmed trade.
 * Push case (X === strike) returns exactly 0 for both, never null.
 */
export function calculatePnl(
  takerSide: "OVER" | "UNDER",
  strike: number,
  settlementValue: number,
  size: number
): PnlResult {
  if (takerSide === "OVER") {
    if (settlementValue > strike) return { takerPnl: size, makerPnl: -size };
    if (settlementValue < strike) return { takerPnl: -size, makerPnl: size };
    return { takerPnl: 0, makerPnl: 0 };
  } else {
    // UNDER
    if (settlementValue < strike) return { takerPnl: size, makerPnl: -size };
    if (settlementValue > strike) return { takerPnl: -size, makerPnl: size };
    return { takerPnl: 0, makerPnl: 0 };
  }
}
