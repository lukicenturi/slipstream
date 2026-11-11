import { describe, expect, it } from "vitest";

import type { Position } from "@/lib/hyperliquid/schemas";

import { hasNoActivity, returnOnEquity, totalUnrealizedPnl, unrealizedPnl } from "./positions";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    coin: "BTC",
    size: 2,
    side: "long",
    leverage: 4,
    leverageType: "cross",
    entryPx: 100,
    positionValue: 200,
    unrealizedPnl: 7,
    roe: 0.07,
    liquidationPx: null,
    marginUsed: 50,
    maxLeverage: 40,
    ...overrides,
  };
}

describe("unrealizedPnl", () => {
  it("uses (mark - entry) * size for a long", () => {
    expect(unrealizedPnl(makePosition(), 110)).toBe(20);
    expect(unrealizedPnl(makePosition(), 95)).toBe(-10);
  });

  it("negates the result for a short", () => {
    const short = makePosition({ size: -2, side: "short" });
    expect(unrealizedPnl(short, 110)).toBe(-20);
    expect(unrealizedPnl(short, 95)).toBe(10);
  });

  it("falls back to the API value when there is no mark", () => {
    expect(unrealizedPnl(makePosition(), undefined)).toBe(7);
    expect(unrealizedPnl(makePosition(), Number.NaN)).toBe(7);
  });
});

describe("returnOnEquity", () => {
  it("divides the PnL by the initial margin", () => {
    // Margin = 2 * 100 / 4 = 50.
    expect(returnOnEquity(makePosition(), 20, 110)).toBeCloseTo(0.4);
  });

  it("falls back to the API value when there is no mark", () => {
    expect(returnOnEquity(makePosition(), 20, undefined)).toBe(0.07);
  });

  it("falls back to the API value when the margin is not positive", () => {
    expect(returnOnEquity(makePosition({ leverage: 0 }), 20, 110)).toBe(0.07);
    expect(returnOnEquity(makePosition({ entryPx: 0 }), 20, 110)).toBe(0.07);
  });
});

describe("totalUnrealizedPnl", () => {
  it("sums live values and uses the API value for coins with no mark", () => {
    const positions = [
      makePosition({ coin: "BTC" }),
      makePosition({ coin: "ETH", size: -1, side: "short", entryPx: 50, unrealizedPnl: 3 }),
      makePosition({ coin: "SOL", unrealizedPnl: -4 }),
    ];
    const marks: Record<string, number> = { BTC: 110, ETH: 40 };
    // BTC +20, ETH +10, SOL falls back to -4.
    expect(totalUnrealizedPnl(positions, (coin) => marks[coin])).toBe(26);
  });

  it("returns 0 for no positions", () => {
    expect(totalUnrealizedPnl([], () => undefined)).toBe(0);
  });
});

describe("hasNoActivity", () => {
  it("is true for the 0.1 USD balance that unknown addresses report", () => {
    expect(hasNoActivity({ accountValue: 0.1, positionCount: 0, fillCount: 0 })).toBe(true);
    expect(hasNoActivity({ accountValue: 0, positionCount: 0, fillCount: 0 })).toBe(true);
  });

  it("is false when the address has funds, positions or fills", () => {
    expect(hasNoActivity({ accountValue: 5, positionCount: 0, fillCount: 0 })).toBe(false);
    expect(hasNoActivity({ accountValue: 0, positionCount: 1, fillCount: 0 })).toBe(false);
    expect(hasNoActivity({ accountValue: 0, positionCount: 0, fillCount: 3 })).toBe(false);
  });
});
