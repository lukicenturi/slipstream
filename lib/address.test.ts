import { describe, expect, it } from "vitest";

import { isAddress, normalizeAddress } from "./address";

const ADDRESS = "0xF5d81a135f756ca16544e53c20fc20643ec3ad53";

describe("isAddress", () => {
  it("accepts 0x plus 40 hex characters", () => {
    expect(isAddress(ADDRESS)).toBe(true);
  });
  it("rejects other strings", () => {
    expect(isAddress("")).toBe(false);
    expect(isAddress(ADDRESS.slice(0, -1))).toBe(false);
    expect(isAddress(`${ADDRESS}0`)).toBe(false);
    expect(isAddress(ADDRESS.replace("0x", "0X"))).toBe(false);
    expect(isAddress(ADDRESS.replace("a", "g"))).toBe(false);
  });
});

describe("normalizeAddress", () => {
  it("trims and lower-cases", () => {
    expect(normalizeAddress(`  ${ADDRESS} `)).toBe(ADDRESS.toLowerCase());
  });
  it("returns null for invalid input", () => {
    expect(normalizeAddress("0x123")).toBeNull();
  });
});
