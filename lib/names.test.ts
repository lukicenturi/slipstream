import { describe, expect, it } from "vitest";

import { isLikelyName, parseSearchInput, pickDisplayName, uniqueAddresses } from "./names";

const ADDRESS = "0xF26F5551E96aE5162509B25925fFfa7F07B2D652";
const LOWER = ADDRESS.toLowerCase();

describe("parseSearchInput", () => {
  it("returns an address in lower case", () => {
    expect(parseSearchInput(ADDRESS)).toEqual({ kind: "address", address: LOWER });
  });

  it("trims white space", () => {
    expect(parseSearchInput(`  ${ADDRESS}\n`)).toEqual({ kind: "address", address: LOWER });
    expect(parseSearchInput("  vitalik.eth ")).toEqual({ kind: "ens", name: "vitalik.eth" });
  });

  it("detects .eth names and lower-cases them", () => {
    expect(parseSearchInput("Vitalik.ETH")).toEqual({ kind: "ens", name: "vitalik.eth" });
    expect(parseSearchInput("pay.vitalik.eth")).toEqual({ kind: "ens", name: "pay.vitalik.eth" });
  });

  it("detects .hl names", () => {
    expect(parseSearchInput("foo.hl")).toEqual({ kind: "hl", name: "foo.hl" });
    expect(parseSearchInput("TESTOOOR.HL")).toEqual({ kind: "hl", name: "testooor.hl" });
  });

  it("returns empty for blank input", () => {
    expect(parseSearchInput("")).toEqual({ kind: "empty" });
    expect(parseSearchInput("   ")).toEqual({ kind: "empty" });
  });

  it("rejects a bare word, a suffix alone and other text", () => {
    expect(parseSearchInput("foo")).toEqual({ kind: "invalid" });
    expect(parseSearchInput(".eth")).toEqual({ kind: "invalid" });
    expect(parseSearchInput("eth")).toEqual({ kind: "invalid" });
    expect(parseSearchInput("foo..eth")).toEqual({ kind: "invalid" });
    expect(parseSearchInput("foo bar.eth")).toEqual({ kind: "invalid" });
    expect(parseSearchInput("foo.com")).toEqual({ kind: "invalid" });
    expect(parseSearchInput("https://foo.eth")).toEqual({ kind: "invalid" });
    expect(parseSearchInput(`${"a".repeat(256)}.eth`)).toEqual({ kind: "invalid" });
  });

  it("rejects an address that is too short", () => {
    expect(parseSearchInput("0x123")).toEqual({ kind: "invalid" });
    expect(parseSearchInput(ADDRESS.slice(0, -1))).toEqual({ kind: "invalid" });
  });
});

describe("isLikelyName", () => {
  it("is true for names only", () => {
    expect(isLikelyName("vitalik.eth")).toBe(true);
    expect(isLikelyName("foo.hl")).toBe(true);
    expect(isLikelyName(ADDRESS)).toBe(false);
    expect(isLikelyName("foo")).toBe(false);
    expect(isLikelyName("")).toBe(false);
  });
});

describe("uniqueAddresses", () => {
  it("lower-cases, drops invalid entries and duplicates, and sorts", () => {
    const other = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    expect(uniqueAddresses([ADDRESS, "nope", other, LOWER, ` ${other} `])).toEqual([other, LOWER]);
  });

  it("keeps the first unique addresses up to the limit", () => {
    const a = `0x${"a".repeat(40)}`;
    const b = `0x${"b".repeat(40)}`;
    const c = `0x${"c".repeat(40)}`;
    expect(uniqueAddresses([c, c, a, b], 2)).toEqual([a, c]);
  });
});

describe("pickDisplayName", () => {
  const all = {
    displayName: "Whale",
    hlName: "testooor.hl",
    ensName: "vitalik.eth",
    address: LOWER,
  };

  it("prefers the Hyperliquid display name", () => {
    expect(pickDisplayName(all)).toEqual({ label: "Whale", source: "hyperliquid" });
  });

  it("then the .hl name", () => {
    expect(pickDisplayName({ ...all, displayName: null })).toEqual({
      label: "testooor.hl",
      source: "hl",
    });
  });

  it("then the ENS name", () => {
    expect(pickDisplayName({ ...all, displayName: "  ", hlName: undefined })).toEqual({
      label: "vitalik.eth",
      source: "ens",
    });
  });

  it("falls back to the short address", () => {
    expect(pickDisplayName({ address: LOWER, hlName: "" })).toEqual({
      label: "0xf26f…d652",
      source: "address",
    });
  });
});
