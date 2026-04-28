import { calculateAvailableMarginPure, worstCaseForContract } from "@/lib/margin";

const userId = 1;
const balance = 1000;

describe("calculateAvailableMarginPure — margin calculator", () => {
  test("Case 1: no trades → available = full balance", () => {
    expect(calculateAvailableMarginPure(balance, [], userId)).toBe(1000);
  });

  test("Case 2: one OVER trade strike 240 size 25 → available = 975", () => {
    const trades = [
      { contractId: 1, takerSide: "OVER" as const, strike: 240, size: 25, takerId: userId },
    ];
    expect(calculateAvailableMarginPure(balance, trades, userId)).toBe(975);
  });

  test("Case 3: two trades same contract with partial hedge → worst = -20", () => {
    const trades = [
      { contractId: 1, takerSide: "OVER" as const, strike: 220, size: 50, takerId: userId },
      { contractId: 1, takerSide: "UNDER" as const, strike: 240, size: 30, takerId: userId },
    ];
    const result = calculateAvailableMarginPure(1000, trades, userId);
    expect(result).toBe(980);
    expect(result).not.toBe(920);
  });

  test("Case 4: two trades different contracts → worst cases summed independently", () => {
    const trades = [
      { contractId: 1, takerSide: "OVER" as const, strike: 220, size: 50, takerId: userId },
      { contractId: 2, takerSide: "UNDER" as const, strike: 300, size: 30, takerId: userId },
    ];
    expect(calculateAvailableMarginPure(1000, trades, userId)).toBe(920);
  });

  test("Case 5: push case at strike captured in test points", () => {
    // Single OVER trade at strike 100 size 10. If settlement === 100, push (P&L=0).
    // Worst-case across strikes - 1, 100, 100 + 1 → -10 (when settlement < 100).
    const w = worstCaseForContract([
      { takerSide: "OVER", strike: 100, size: 10, isAsTaker: true },
    ]);
    expect(w).toBe(-10);
  });

  test("Case 6: maker side flips P&L sign", () => {
    // User is maker on an OVER trade — so isAsTaker=false. Their worst-case is
    // when taker wins (settlement > 100): -size.
    const w = worstCaseForContract([
      { takerSide: "OVER", strike: 100, size: 7, isAsTaker: false },
    ]);
    expect(w).toBe(-7);
  });
});
