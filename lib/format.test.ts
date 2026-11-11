import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatPercent,
  formatPrice,
  formatRelativeTime,
  formatSize,
  formatUsd,
  shortAddress,
} from "./format";

describe("formatUsd", () => {
  it("formats large values without cents", () => {
    expect(formatUsd(146_792_255.3)).toBe("$146,792,255");
  });
  it("formats small values with cents", () => {
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(0)).toBe("$0.00");
  });
  it("formats compact values", () => {
    expect(formatUsd(146_792_255, { compact: true })).toBe("$146.8M");
    expect(formatUsd(1_234, { compact: true })).toBe("$1.2K");
    expect(formatUsd(999.5, { compact: true })).toBe("$999.50");
  });
  it("adds signs", () => {
    expect(formatUsd(1_234, { compact: true, signed: true })).toBe("+$1.2K");
    expect(formatUsd(-1_234, { compact: true, signed: true })).toBe("-$1.2K");
    expect(formatUsd(-12.5)).toBe("-$12.50");
    expect(formatUsd(0, { signed: true })).toBe("$0.00");
    expect(formatUsd(-0.001, { signed: true })).toBe("$0.00");
  });
  it("renders non-finite values as a dash", () => {
    expect(formatUsd(Number.NaN)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats ratios as percent", () => {
    expect(formatPercent(0.8369)).toBe("83.69%");
    expect(formatPercent(0.8369, { signed: true })).toBe("+83.69%");
    expect(formatPercent(-0.0011, { signed: true })).toBe("-0.11%");
    expect(formatPercent(5.5615)).toBe("556.15%");
    expect(formatPercent(0, { signed: true })).toBe("0.00%");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatPrice", () => {
  it("keeps at least 2 decimals for values of 1 and above", () => {
    expect(formatPrice(73_848.5)).toBe("73,848.50");
    expect(formatPrice(2_062.05)).toBe("2,062.05");
    expect(formatPrice(100)).toBe("100.00");
  });
  it("uses up to 5 significant digits", () => {
    expect(formatPrice(82.8215)).toBe("82.822");
    expect(formatPrice(1.05415)).toBe("1.0542");
    expect(formatPrice(0.116438)).toBe("0.11644");
    expect(formatPrice(0.0678)).toBe("0.0678");
  });
  it("handles zero, negatives and non-finite values", () => {
    expect(formatPrice(0)).toBe("0");
    expect(formatPrice(-2.5)).toBe("-2.50");
    expect(formatPrice(Number.NaN)).toBe("—");
  });
});

describe("formatSize", () => {
  it("shows up to 4 decimals and trims zeros", () => {
    expect(formatSize(21.88561)).toBe("21.8856");
    expect(formatSize(13)).toBe("13");
    expect(formatSize(5_600_517)).toBe("5,600,517");
    expect(formatSize(-436.5)).toBe("-436.5");
    expect(formatSize(0.00001)).toBe("0");
  });
});

describe("shortAddress", () => {
  it("keeps the first 6 and last 4 characters", () => {
    expect(shortAddress("0xf5d81a135f756ca16544e53c20fc20643ec3ad53")).toBe("0xf5d8…ad53");
  });
  it("returns short strings unchanged", () => {
    expect(shortAddress("0x1234")).toBe("0x1234");
  });
});

describe("formatRelativeTime", () => {
  const now = 1_000_000_000_000;
  it("uses the largest unit", () => {
    expect(formatRelativeTime(now - 12_000, now)).toBe("12s ago");
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe("3m ago");
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(formatRelativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
  });
  it("clamps future times to 0s ago", () => {
    expect(formatRelativeTime(now + 5_000, now)).toBe("0s ago");
  });
});

describe("formatDuration", () => {
  it("shows the two largest units", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(5 * 60_000 + 12_000)).toBe("5m 12s");
    expect(formatDuration(2 * 3_600_000 + 15 * 60_000)).toBe("2h 15m");
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000 + 59_000)).toBe("3d 4h");
  });
  it("drops a zero second unit and handles zero", () => {
    expect(formatDuration(2 * 3_600_000)).toBe("2h");
    expect(formatDuration(0)).toBe("0s");
  });
});
