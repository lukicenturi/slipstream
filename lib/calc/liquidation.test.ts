import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAINTENANCE_MARGIN_RATE,
  estimateLiquidation,
  estimateMargin,
  maintenanceMarginRate,
  positionSizeInCoin,
} from "./liquidation";

describe("estimateLiquidation", () => {
  it("estimates a 10x long at 100 with a 0.5% rate", () => {
    const result = estimateLiquidation({
      entryPx: 100,
      leverage: 10,
      side: "long",
      maintenanceMarginRate: 0.005,
    });
    expect(result?.liquidationPx).toBeCloseTo(90.5, 10);
  });

  it("estimates a 10x short at 100 with a 0.5% rate", () => {
    const result = estimateLiquidation({
      entryPx: 100,
      leverage: 10,
      side: "short",
      maintenanceMarginRate: 0.005,
    });
    expect(result?.liquidationPx).toBeCloseTo(109.5, 10);
  });

  it("puts a 1x long near zero", () => {
    const result = estimateLiquidation({
      entryPx: 100,
      leverage: 1,
      side: "long",
      maintenanceMarginRate: 0.005,
    });
    expect(result?.liquidationPx).toBeCloseTo(0.5, 10);
  });

  it("returns null for a leverage of 0, below 1 or not finite", () => {
    expect(estimateLiquidation({ entryPx: 100, leverage: 0, side: "long" })).toBeNull();
    expect(estimateLiquidation({ entryPx: 100, leverage: 0.5, side: "short" })).toBeNull();
    expect(estimateLiquidation({ entryPx: 100, leverage: Number.NaN, side: "long" })).toBeNull();
  });

  it("returns null for an entry price that is not positive", () => {
    expect(estimateLiquidation({ entryPx: 0, leverage: 5, side: "long" })).toBeNull();
    expect(estimateLiquidation({ entryPx: -1, leverage: 5, side: "long" })).toBeNull();
  });

  it("uses 1 / (2 * maxLeverage) as the default rate", () => {
    const result = estimateLiquidation({
      entryPx: 100,
      leverage: 10,
      side: "long",
      maxLeverage: 40,
    });
    expect(result?.maintenanceMarginRate).toBeCloseTo(0.0125, 10);
    expect(result?.liquidationPx).toBeCloseTo(91.25, 10);
  });

  it("uses 0.5% when the max leverage is not known", () => {
    const result = estimateLiquidation({ entryPx: 200, leverage: 4, side: "short" });
    expect(result?.maintenanceMarginRate).toBe(DEFAULT_MAINTENANCE_MARGIN_RATE);
    expect(result?.liquidationPx).toBeCloseTo(249, 10);
  });

  it("returns null for a rate outside [0, 1)", () => {
    expect(
      estimateLiquidation({ entryPx: 100, leverage: 2, side: "long", maintenanceMarginRate: -0.1 }),
    ).toBeNull();
    expect(
      estimateLiquidation({ entryPx: 100, leverage: 2, side: "short", maintenanceMarginRate: 1 }),
    ).toBeNull();
  });
});

describe("maintenanceMarginRate", () => {
  it("prefers the given rate over the max leverage", () => {
    expect(maintenanceMarginRate({ maintenanceMarginRate: 0.01, maxLeverage: 50 })).toBe(0.01);
  });

  it("ignores a max leverage below 1", () => {
    expect(maintenanceMarginRate({ maxLeverage: 0 })).toBe(DEFAULT_MAINTENANCE_MARGIN_RATE);
  });
});

describe("estimateMargin", () => {
  it("divides the size by the leverage", () => {
    expect(estimateMargin(1000, 5)).toBe(200);
    expect(estimateMargin(50, 1)).toBe(50);
  });

  it("returns null for bad input", () => {
    expect(estimateMargin(1000, 0)).toBeNull();
    expect(estimateMargin(-1, 5)).toBeNull();
    expect(estimateMargin(Number.POSITIVE_INFINITY, 5)).toBeNull();
  });
});

describe("positionSizeInCoin", () => {
  it("divides the size by the price", () => {
    expect(positionSizeInCoin(1000, 50_000)).toBeCloseTo(0.02, 10);
  });

  it("returns null without a usable price", () => {
    expect(positionSizeInCoin(1000, undefined)).toBeNull();
    expect(positionSizeInCoin(1000, 0)).toBeNull();
  });
});
