import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_LEVERAGE,
  DEFAULT_SIZE_USD,
  clampSizeUsd,
  initialLeverage,
  parseSizeInput,
  resolveMaxLeverage,
} from "./copyTrade";

describe("clampSizeUsd", () => {
  it("keeps the size inside 50 to 10,000", () => {
    expect(clampSizeUsd(10)).toBe(50);
    expect(clampSizeUsd(1234)).toBe(1234);
    expect(clampSizeUsd(25_000)).toBe(10_000);
  });

  it("returns the default for a value that is not finite", () => {
    expect(clampSizeUsd(Number.NaN)).toBe(DEFAULT_SIZE_USD);
  });
});

describe("parseSizeInput", () => {
  it("accepts plain numbers, commas and a dollar sign", () => {
    expect(parseSizeInput("1250")).toBe(1250);
    expect(parseSizeInput("1,250")).toBe(1250);
    expect(parseSizeInput("$1250.5")).toBe(1250.5);
    expect(parseSizeInput(".5")).toBe(0.5);
  });

  it("returns null for text that is not a number", () => {
    expect(parseSizeInput("")).toBeNull();
    expect(parseSizeInput("abc")).toBeNull();
    expect(parseSizeInput("-5")).toBeNull();
    expect(parseSizeInput("1e3")).toBeNull();
  });
});

describe("resolveMaxLeverage", () => {
  it("uses the coin's limit when known", () => {
    expect(resolveMaxLeverage(40)).toBe(40);
    expect(resolveMaxLeverage(3)).toBe(3);
  });

  it("falls back to 20", () => {
    expect(resolveMaxLeverage(undefined)).toBe(DEFAULT_MAX_LEVERAGE);
    expect(resolveMaxLeverage(0)).toBe(DEFAULT_MAX_LEVERAGE);
  });
});

describe("initialLeverage", () => {
  it("uses the trader's leverage inside the limit", () => {
    expect(initialLeverage(3, 40)).toBe(3);
    expect(initialLeverage(50, 40)).toBe(40);
  });

  it("uses 5x when the leverage is not known, capped by the limit", () => {
    expect(initialLeverage(undefined, 20)).toBe(5);
    expect(initialLeverage(undefined, 3)).toBe(3);
  });
});
