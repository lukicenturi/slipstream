import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { allMidsSchema, clearinghouseStateSchema, metaSchema } from "./schemas";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));
}

describe("metaSchema (testnet fixture)", () => {
  const assets = metaSchema.parse(fixture("testnet-meta.json"));

  it("gives each asset its position in the universe as the index", () => {
    expect(assets).toHaveLength(10);
    assets.forEach((asset, position) => expect(asset.index).toBe(position));
    // The fixture keeps the first 5 assets of the real universe, so BTC is at 3 as on testnet.
    expect(assets[3]).toEqual({
      index: 3,
      name: "BTC",
      szDecimals: 5,
      maxLeverage: 40,
      onlyIsolated: false,
      isDelisted: false,
    });
  });

  it("reads the isolated-only and delisted flags", () => {
    const hype = assets.find((asset) => asset.name === "HYPE");
    expect(hype?.onlyIsolated).toBe(true);
    const matic = assets.find((asset) => asset.name === "MATIC");
    expect(matic?.isDelisted).toBe(true);
  });

  it("rejects a universe entry without szDecimals", () => {
    const result = metaSchema.safeParse({ universe: [{ name: "BTC", maxLeverage: 40 }] });
    expect(result.success).toBe(false);
  });

  it("rejects a response without a universe", () => {
    expect(metaSchema.safeParse({}).success).toBe(false);
  });
});

describe("allMidsSchema (testnet fixture)", () => {
  it("keeps perp mids as numbers and drops spot and builder keys", () => {
    const mids = allMidsSchema.parse(fixture("testnet-allMids.json"));
    expect(mids.BTC).toBe(74712);
    expect(mids.ETH).toBeCloseTo(2017.15);
    expect(Object.keys(mids).some((coin) => coin.startsWith("@") || coin.startsWith("#"))).toBe(
      false,
    );
  });

  it("skips one bad value instead of failing", () => {
    expect(allMidsSchema.parse({ BTC: "abc", ETH: "2000" })).toEqual({ ETH: 2000 });
  });
});

describe("clearinghouseStateSchema (testnet fixture)", () => {
  it("parses an empty testnet account", () => {
    const state = clearinghouseStateSchema.parse(fixture("testnet-clearinghouseState-empty.json"));
    expect(state.accountValue).toBe(0);
    expect(state.withdrawable).toBe(0);
    expect(state.positions).toEqual([]);
  });
});
