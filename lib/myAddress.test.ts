import { describe, expect, it } from "vitest";

import { clearMyAddress, MY_ADDRESS_STORAGE_KEY, parseMyAddress, setMyAddress } from "./myAddress";

const ADDRESS = "0xf26f5551e96ae5162509b25925fffa7f07b2d652";

describe("MY_ADDRESS_STORAGE_KEY", () => {
  it("uses the slipstream prefix", () => {
    expect(MY_ADDRESS_STORAGE_KEY).toBe("slipstream.myAddress");
  });
});

describe("parseMyAddress", () => {
  it("returns null for a missing value or bad JSON", () => {
    expect(parseMyAddress(null)).toBe(null);
    expect(parseMyAddress("")).toBe(null);
    expect(parseMyAddress("{")).toBe(null);
    expect(parseMyAddress("null")).toBe(null);
    expect(parseMyAddress("[]")).toBe(null);
  });

  it("reads a saved address and lower-cases it", () => {
    const raw = JSON.stringify({ address: ADDRESS.toUpperCase().replace("0X", "0x"), savedAt: 1 });
    expect(parseMyAddress(raw)).toEqual({ address: ADDRESS, savedAt: 1 });
  });

  it("keeps a saved label", () => {
    const raw = JSON.stringify({ address: ADDRESS, label: "testooor.hl", savedAt: 2 });
    expect(parseMyAddress(raw)).toEqual({ address: ADDRESS, label: "testooor.hl", savedAt: 2 });
  });

  it("drops a bad label but keeps the address", () => {
    const raw = JSON.stringify({ address: ADDRESS, label: 42, savedAt: 3 });
    expect(parseMyAddress(raw)).toEqual({ address: ADDRESS, savedAt: 3 });
    const empty = JSON.stringify({ address: ADDRESS, label: "  ", savedAt: 3 });
    expect(parseMyAddress(empty)).toEqual({ address: ADDRESS, savedAt: 3 });
  });

  it("returns null for a bad address or a missing time", () => {
    expect(parseMyAddress(JSON.stringify({ address: "0x123", savedAt: 1 }))).toBe(null);
    expect(parseMyAddress(JSON.stringify({ address: ADDRESS }))).toBe(null);
    expect(parseMyAddress(JSON.stringify({ address: ADDRESS, savedAt: "1" }))).toBe(null);
  });
});

describe("setMyAddress", () => {
  it("builds the value for an address", () => {
    expect(setMyAddress(` ${ADDRESS} `, undefined, 10)).toEqual({ address: ADDRESS, savedAt: 10 });
  });

  it("keeps a name as the label and drops an empty one", () => {
    expect(setMyAddress(ADDRESS, "testooor.hl", 11)).toEqual({
      address: ADDRESS,
      label: "testooor.hl",
      savedAt: 11,
    });
    expect(setMyAddress(ADDRESS, " ", 12)).toEqual({ address: ADDRESS, savedAt: 12 });
  });

  it("returns null for an address that is not valid", () => {
    expect(setMyAddress("0x123")).toBe(null);
    expect(setMyAddress("testooor.hl")).toBe(null);
  });

  it("round-trips through JSON and parseMyAddress", () => {
    const value = setMyAddress(ADDRESS, "testooor.hl", 13);
    expect(parseMyAddress(JSON.stringify(value))).toEqual(value);
  });
});

describe("clearMyAddress", () => {
  it("returns nothing saved", () => {
    expect(clearMyAddress()).toBe(null);
  });
});
