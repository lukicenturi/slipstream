import { describe, expect, it } from "vitest";

import { parseWatchlist, toggleWatchlist } from "./watchlist";

const A = "0xf5d81a135f756ca16544e53c20fc20643ec3ad53";
const B = "0x0000000000000000000000000000000000000001";

describe("parseWatchlist", () => {
  it("returns an empty list for a missing value", () => {
    expect(parseWatchlist(null)).toEqual([]);
  });

  it("returns an empty list for bad JSON or a value that is not an array", () => {
    expect(parseWatchlist("{not json")).toEqual([]);
    expect(parseWatchlist('{"a":1}')).toEqual([]);
    expect(parseWatchlist('"0xabc"')).toEqual([]);
  });

  it("lower-cases addresses, drops bad entries and removes duplicates", () => {
    const raw = JSON.stringify([A.toUpperCase().replace("0X", "0x"), A, 42, "0x12", null, B]);
    expect(parseWatchlist(raw)).toEqual([A, B]);
  });
});

describe("toggleWatchlist", () => {
  it("adds a missing address to the end in lower case", () => {
    expect(toggleWatchlist([B], A.toUpperCase().replace("0X", "0x"))).toEqual([B, A]);
  });

  it("removes an address that is in the list", () => {
    expect(toggleWatchlist([A, B], A)).toEqual([B]);
  });

  it("does not change the input list", () => {
    const list = [A];
    toggleWatchlist(list, B);
    expect(list).toEqual([A]);
  });
});
