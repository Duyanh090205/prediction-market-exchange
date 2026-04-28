import { calculatePnl } from "@/lib/pnl";

describe("calculatePnl — binary spread betting P&L", () => {
  // OVER cases
  test("OVER, X > strike → taker +size, maker -size", () => {
    expect(calculatePnl("OVER", 240, 255, 25)).toEqual({ takerPnl: 25, makerPnl: -25 });
  });

  test("OVER, X < strike → taker -size, maker +size", () => {
    expect(calculatePnl("OVER", 240, 200, 25)).toEqual({ takerPnl: -25, makerPnl: 25 });
  });

  test("OVER, X = strike → both exactly 0 (push, not null)", () => {
    const result = calculatePnl("OVER", 240, 240, 25);
    expect(result).toEqual({ takerPnl: 0, makerPnl: 0 });
    expect(result.takerPnl).toStrictEqual(0);
    expect(result.makerPnl).toStrictEqual(0);
  });

  // UNDER cases
  test("UNDER, X < strike → taker +size, maker -size", () => {
    expect(calculatePnl("UNDER", 220, 200, 30)).toEqual({ takerPnl: 30, makerPnl: -30 });
  });

  test("UNDER, X > strike → taker -size, maker +size", () => {
    expect(calculatePnl("UNDER", 220, 255, 30)).toEqual({ takerPnl: -30, makerPnl: 30 });
  });

  test("UNDER, X = strike → both exactly 0 (push)", () => {
    const result = calculatePnl("UNDER", 220, 220, 30);
    expect(result).toEqual({ takerPnl: 0, makerPnl: 0 });
    expect(result.takerPnl).toStrictEqual(0);
    expect(result.makerPnl).toStrictEqual(0);
  });
});
