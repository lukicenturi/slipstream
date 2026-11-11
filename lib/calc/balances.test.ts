import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  clearinghouseStateSchema,
  ledgerDexMovesSchema,
  perpDexsSchema,
  spotClearinghouseStateSchema,
  type ClearinghouseState,
  type LedgerDexMove,
  type SpotBalance,
} from "@/lib/hyperliquid/schemas";
import { buildSpotTokenMap } from "@/lib/hyperliquid/spot-meta-trim";

import {
  balanceRows,
  builderDexWithUsdc,
  collectPositions,
  dexOfCoin,
  dexesFromLedger,
  discoverDexes,
  isSmallBalance,
  perpAccounts,
  priceSpotBalances,
  queriesAllDexes,
  spotPairsOf,
  summarizeAccount,
} from "./balances";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));
}

const USER = "0x9dbe4eb4a0a41955e1dc733e322f84295a0aa5c0";
const OTHER = "0x77c952b41280173d5d6af70491f96a5251f365b0";

// The user's testnet account on 2026-11-11 (fixtures captured with curl).
const mainState = clearinghouseStateSchema.parse(fixture("testnet-clearinghouseState-empty.json"));
const vntlsState = clearinghouseStateSchema.parse(fixture("clearinghouseState-dex.json"));
const spotBalances = spotClearinghouseStateSchema.parse(fixture("spotClearinghouseState.json"));
const tokenMap = buildSpotTokenMap(fixture("spotMeta.json"), 1).tokens;
// Testnet allMids at the same time: HARRR/USDC, HAR/USDC and TACO/USDC.
const testnetMids: Record<string, number> = {
  "@1382": 0.799995,
  "@1324": 0.00006349,
  "@1219": 0.000358,
};
const getMid = (pair: string): number | undefined => testnetMids[pair];

function move(overrides: Partial<LedgerDexMove>): LedgerDexMove {
  return { user: null, destination: null, sourceDex: null, destinationDex: null, ...overrides };
}

function stateWith(overrides: Partial<ClearinghouseState>): ClearinghouseState {
  return { ...mainState, ...overrides };
}

describe("dexOfCoin", () => {
  it("reads the dex prefix of a builder coin", () => {
    expect(dexOfCoin("vntls:vOAI")).toBe("vntls");
    expect(dexOfCoin("xyz:NVDA")).toBe("xyz");
  });

  it("gives null for main perps and spot pairs", () => {
    expect(dexOfCoin("BTC")).toBeNull();
    expect(dexOfCoin("@1035")).toBeNull();
    expect(dexOfCoin(":X")).toBeNull();
  });
});

describe("dexesFromLedger", () => {
  it("finds the destination exchange of a send to the user (fixture)", () => {
    const moves = ledgerDexMovesSchema.parse(fixture("ledgerUpdates.json"));
    expect(dexesFromLedger(moves, USER)).toEqual(["vntls"]);
  });

  it("uses the source exchange for a send by the user", () => {
    const moves = [
      move({ user: USER, destination: OTHER, sourceDex: "flx", destinationDex: "xyz" }),
    ];
    expect(dexesFromLedger(moves, USER)).toEqual(["flx"]);
  });

  it("ignores the main exchange and spot", () => {
    const moves = [
      move({ user: USER, destination: OTHER, sourceDex: "spot", destinationDex: "spot" }),
      move({ user: OTHER, destination: USER, sourceDex: "", destinationDex: "" }),
    ];
    expect(dexesFromLedger(moves, USER)).toEqual([]);
  });

  it("counts both names when sender and receiver are unknown", () => {
    const moves = [move({ sourceDex: "b", destinationDex: "a" })];
    expect(dexesFromLedger(moves, USER)).toEqual(["a", "b"]);
  });

  it("matches the address in any case", () => {
    const moves = [move({ user: OTHER, destination: USER, destinationDex: "vntls" })];
    expect(dexesFromLedger(moves, USER.toUpperCase().replace("0X", "0x"))).toEqual(["vntls"]);
  });
});

describe("discoverDexes", () => {
  const mainnetDexes = ["xyz", "flx", "vntl", "hyna", "km", "abcd", "cash", "para", "mkts", "io"];

  it("reads every exchange when the list has at most 20 entries", () => {
    expect(discoverDexes({ allDexes: mainnetDexes, fillCoins: [], ledgerDexes: [] })).toEqual(
      mainnetDexes,
    );
    expect(queriesAllDexes(mainnetDexes)).toBe(true);
  });

  it("reads only the exchanges in fills and ledger when the list is long", () => {
    const testnetDexes = Array.from({ length: 278 }, (_, index) => `d${index}`).concat("vntls");
    expect(queriesAllDexes(testnetDexes)).toBe(false);
    expect(
      discoverDexes({
        allDexes: testnetDexes,
        fillCoins: ["@1035", "vntls:vOAI", "BTC"],
        ledgerDexes: ["vntls", "d3"],
      }),
    ).toEqual(["d3", "vntls"]);
  });

  it("drops names that the known list does not hold", () => {
    expect(
      discoverDexes({
        allDexes: ["a", "b", "c"],
        fillCoins: ["zzz:X", "a:Y"],
        ledgerDexes: [],
        queryAllLimit: 2,
      }),
    ).toEqual(["a"]);
  });

  it("uses the signals alone when the list did not load", () => {
    expect(
      discoverDexes({ allDexes: null, fillCoins: ["vntls:vOAI"], ledgerDexes: ["spot", ""] }),
    ).toEqual(["vntls"]);
    expect(queriesAllDexes(null)).toBe(false);
  });

  it("reads the list from the perpDexs fixture", () => {
    const names = perpDexsSchema.parse(fixture("perpDexs.json")).map((dex) => dex.name);
    expect(discoverDexes({ allDexes: names, fillCoins: [], ledgerDexes: [] })).toEqual(names);
  });
});

describe("priceSpotBalances", () => {
  it("prices USDC 1:1 and other tokens with the mid of their USDC pair", () => {
    const rows = priceSpotBalances(spotBalances, tokenMap, getMid);
    const byCoin = new Map(rows.map((row) => [row.coin, row]));
    expect(byCoin.get("USDC")?.usdValue).toBeCloseTo(0.7968);
    expect(byCoin.get("HARRR")?.pair).toBe("@1382");
    expect(byCoin.get("HARRR")?.usdValue).toBeCloseTo(195.49, 2);
    expect(byCoin.get("HAR")?.usdValue).toBeCloseTo(0.2182, 3);
    expect(byCoin.get("TACO")?.usdValue).toBeCloseTo(3.58, 2);
  });

  it("gives null for a token without a USDC pair or without a mid", () => {
    const rows = priceSpotBalances(spotBalances, tokenMap, () => undefined);
    const byCoin = new Map(rows.map((row) => [row.coin, row]));
    expect(byCoin.get("SLIM")?.pair).toBeNull();
    expect(byCoin.get("SLIM")?.usdValue).toBeNull();
    expect(byCoin.get("HARRR")?.usdValue).toBeNull();
    expect(byCoin.get("USDC")?.usdValue).toBeCloseTo(0.7968);
  });

  it("gives null for every token but USDC before the token map loads", () => {
    const rows = priceSpotBalances(spotBalances, undefined, getMid);
    expect(rows.filter((row) => row.usdValue !== null).map((row) => row.coin)).toEqual(["USDC"]);
  });

  it("does not treat a prototype key as a token", () => {
    const balance: SpotBalance = { coin: "toString", token: 9, total: 5, hold: 0, entryNtl: 0 };
    const [row] = priceSpotBalances([balance], tokenMap, () => 2);
    expect(row?.pair).toBeNull();
    expect(row?.usdValue).toBeNull();
  });

  it("lists the pairs that need a mid", () => {
    expect(spotPairsOf(spotBalances, tokenMap)).toEqual(["@1219", "@1324", "@1382"]);
  });
});

describe("summarizeAccount (the user's testnet account)", () => {
  const spotRows = priceSpotBalances(spotBalances, tokenMap, getMid);
  const summary = summarizeAccount({
    main: mainState,
    dexStates: [{ dex: "vntls", state: vntlsState }],
    spotRows,
  });

  it("adds the perp accounts of every exchange", () => {
    expect(summary.perpsUsd).toBeCloseTo(67.73, 2);
    expect(summary.perpsByDex).toEqual([
      { dex: null, accountValue: 0, withdrawable: 0, marginUsed: 0 },
      { dex: "vntls", accountValue: 67.728746, withdrawable: 67.728746, marginUsed: 0 },
    ]);
  });

  it("adds priced spot and counts unpriced tokens", () => {
    // HARRR 195.49 + USDC 0.80 + TACO 3.58 + HAR 0.22
    expect(summary.spotUsd).toBeCloseTo(195.4898 + 0.7968 + 3.58 + 0.2182, 2);
    expect(summary.spotUnpricedCount).toBe(1);
    expect(summary.spotWaitingCount).toBe(0);
    expect(summary.totalUsd).toBeCloseTo(summary.perpsUsd + summary.spotUsd, 6);
    expect(summary.totalUsd).toBeGreaterThan(264);
  });

  it("finds the builder exchange that holds the USDC", () => {
    expect(builderDexWithUsdc(summary.perpsByDex)?.dex).toBe("vntls");
    expect(builderDexWithUsdc(summary.perpsByDex.slice(0, 1))).toBeNull();
  });

  it("gives every position its exchange", () => {
    const base = clearinghouseStateSchema.parse(fixture("clearinghouseState.json"));
    const [first] = base.positions;
    if (!first) throw new Error("The fixture has no position");
    const dexPosition = { ...first, coin: "vntls:vOAI" };
    const positions = collectPositions(stateWith({ positions: [first] }), [
      { dex: "vntls", state: stateWith({ positions: [dexPosition] }) },
    ]);
    expect(positions.map((position) => [position.coin, position.dex])).toEqual([
      [first.coin, null],
      ["vntls:vOAI", "vntls"],
    ]);
  });
});

describe("summarizeAccount before the first mids", () => {
  it("counts the tokens that wait for a mid apart from those without a pair", () => {
    const spotRows = priceSpotBalances(spotBalances, tokenMap, () => undefined);
    const summary = summarizeAccount({ main: mainState, dexStates: [], spotRows });
    expect(summary.spotUnpricedCount).toBe(4);
    expect(summary.spotWaitingCount).toBe(3);
    expect(summary.spotUsd).toBeCloseTo(0.7968);
  });
});

describe("summarizeAccount for a unified account", () => {
  // Mainnet 0x5b5d…c060 on 2026-11-11 (userAbstraction "unifiedAccount"): the spot
  // USDC hold equals the perp margin of the main and the xyz exchange.
  const main = stateWith({ accountValue: 84_997_191.92, withdrawable: 20_319.85 });
  const xyz = stateWith({ accountValue: 10_803_491.11, withdrawable: 8_085.65 });
  const spotRows = priceSpotBalances(
    [{ coin: "USDC", token: 0, total: 101_690_152.78, hold: 95_800_683.03, entryNtl: 0 }],
    tokenMap,
    getMid,
  );

  it("does not add the perp accounts on top of spot USDC", () => {
    const summary = summarizeAccount({
      main,
      dexStates: [{ dex: "xyz", state: xyz }],
      spotRows,
      unified: true,
    });
    expect(summary.unified).toBe(true);
    expect(summary.totalUsd).toBeCloseTo(101_690_152.78, 2);
    expect(summary.perpsUsd).toBeCloseTo(95_800_683.03, 2);
  });

  it("adds them for a standard account", () => {
    const summary = summarizeAccount({ main, dexStates: [{ dex: "xyz", state: xyz }], spotRows });
    expect(summary.unified).toBe(false);
    expect(summary.totalUsd).toBeCloseTo(101_690_152.78 + 95_800_683.03, 2);
  });

  it("marks the perp rows as outside the total", () => {
    const rows = balanceRows(perpAccounts(main, []), spotRows, true);
    expect(rows.map((row) => [row.id, row.inTotal])).toEqual([
      ["spot:USDC", true],
      ["perp:main", false],
    ]);
  });
});

describe("isSmallBalance", () => {
  it("is small below the threshold", () => {
    expect(isSmallBalance({ total: 3436, usdValue: 0.22 })).toBe(true);
    expect(isSmallBalance({ total: 244, usdValue: 195.49 })).toBe(false);
    expect(isSmallBalance({ total: 5, usdValue: 5 }, 10)).toBe(true);
  });

  it("keeps an unpriced balance unless its total is 0", () => {
    expect(isSmallBalance({ total: 2766, usdValue: null })).toBe(false);
    expect(isSmallBalance({ total: 0, usdValue: null })).toBe(true);
  });
});

describe("balanceRows", () => {
  it("sorts by USD value, largest first, with unpriced rows last", () => {
    const spotRows = priceSpotBalances(spotBalances, tokenMap, getMid);
    const summary = summarizeAccount({
      main: mainState,
      dexStates: [{ dex: "vntls", state: vntlsState }],
      spotRows,
    });
    const rows = balanceRows(summary.perpsByDex, spotRows);
    expect(rows.map((row) => row.id)).toEqual([
      "spot:HARRR",
      "perp:vntls",
      "spot:TACO",
      "spot:USDC",
      "spot:HAR",
      "perp:main",
      "spot:SLIM",
    ]);
    const visible = rows.filter((row) => !isSmallBalance(row)).map((row) => row.id);
    expect(visible).toEqual(["spot:HARRR", "perp:vntls", "spot:TACO", "spot:SLIM"]);
    expect(rows.find((row) => row.id === "perp:vntls")).toMatchObject({
      asset: "USDC",
      kind: "perp",
      dex: "vntls",
      available: 67.728746,
    });
  });
});
