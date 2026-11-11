import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  clearinghouseStateSchema,
  isUnifiedAbstraction,
  userAbstractionSchema,
  ledgerDexMovesSchema,
  perpDexsSchema,
  spotClearinghouseStateSchema,
  spotMetaSchema,
  spotTokenMapSchema,
} from "./schemas";
import { buildSpotTokenMap } from "./spot-meta-trim";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));
}

describe("perpDexsSchema (testnet fixture)", () => {
  it("skips the leading null (the main exchange) and keeps name and full name", () => {
    const dexes = perpDexsSchema.parse(fixture("perpDexs.json"));
    expect(dexes).toHaveLength(4);
    expect(dexes[0]).toEqual({ name: "test", fullName: "test dex" });
    for (const dex of dexes) expect(dex.name.length).toBeGreaterThan(0);
  });

  it("accepts a missing full name", () => {
    expect(perpDexsSchema.parse([null, { name: "xyz" }])).toEqual([
      { name: "xyz", fullName: null },
    ]);
  });

  it("rejects an entry without a name", () => {
    expect(perpDexsSchema.safeParse([null, { fullName: "X" }]).success).toBe(false);
  });
});

describe("clearinghouseState of a builder exchange", () => {
  it("has the same shape as the main state", () => {
    const state = clearinghouseStateSchema.parse(fixture("clearinghouseState-dex.json"));
    expect(state.accountValue).toBeCloseTo(67.728746);
    expect(state.withdrawable).toBeCloseTo(67.728746);
    expect(state.positions).toEqual([]);
  });
});

describe("spotClearinghouseStateSchema (testnet fixture)", () => {
  it("parses every balance with numbers", () => {
    const balances = spotClearinghouseStateSchema.parse(fixture("spotClearinghouseState.json"));
    expect(balances.map((balance) => balance.coin)).toEqual([
      "USDC",
      "HAR",
      "TACO",
      "HARRR",
      "SLIM",
    ]);
    const harrr = balances.find((balance) => balance.coin === "HARRR");
    expect(harrr).toEqual({
      coin: "HARRR",
      token: 1483,
      total: 244.36306387,
      hold: 0,
      entryNtl: 0.00244363,
    });
  });

  it("rejects a balance with a bad total", () => {
    const bad = { balances: [{ coin: "X", token: 1, total: "abc", hold: "0", entryNtl: "0" }] };
    expect(spotClearinghouseStateSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ledgerDexMovesSchema (testnet fixture)", () => {
  it("keeps only the deltas with a dex field", () => {
    const moves = ledgerDexMovesSchema.parse(fixture("ledgerUpdates.json"));
    expect(moves).toEqual([
      {
        user: "0x77c952b41280173d5d6af70491f96a5251f365b0",
        destination: "0x9dbe4eb4a0a41955e1dc733e322f84295a0aa5c0",
        sourceDex: "",
        destinationDex: "vntls",
      },
    ]);
  });

  it("skips entries that do not match instead of failing", () => {
    expect(ledgerDexMovesSchema.parse([null, 3, { delta: "x" }, { time: 1 }])).toEqual([]);
  });

  it("rejects a body that is not an array", () => {
    expect(ledgerDexMovesSchema.safeParse({}).success).toBe(false);
  });
});

describe("spot token map", () => {
  it("parses the trimmed spotMeta fixture", () => {
    const meta = spotMetaSchema.parse(fixture("spotMeta.json"));
    expect(meta.tokens).toHaveLength(10);
    expect(meta.universe).toHaveLength(10);
  });

  it("maps each token to its USDC pair", () => {
    const map = buildSpotTokenMap(fixture("spotMeta.json"), 1);
    expect(spotTokenMapSchema.parse(map)).toEqual(map);
    expect(map.tokens.HARRR).toEqual({ index: 1483, szDecimals: 2, pair: "@1382" });
    expect(map.tokens.HAR?.pair).toBe("@1324");
    expect(map.tokens.TACO?.pair).toBe("@1219");
    // The first pair keeps its name instead of an "@" key.
    expect(map.tokens.PURR?.pair).toBe("PURR/USDC");
    // SLIM has no USDC pair; HYPE only trades against another token here.
    expect(map.tokens.SLIM?.pair).toBeNull();
    expect(map.tokens.HYPE?.pair).toBeNull();
    // USDC is the quote token, not a base.
    expect(map.tokens.USDC?.pair).toBeNull();
  });

  it("prefers a canonical USDC pair and keeps a token named like a prototype key", () => {
    const map = buildSpotTokenMap(
      {
        tokens: [
          { name: "USDC", index: 0, szDecimals: 8 },
          { name: "constructor", index: 5, szDecimals: 2 },
        ],
        universe: [
          { name: "@10", index: 10, tokens: [5, 0], isCanonical: false },
          { name: "@11", index: 11, tokens: [5, 0], isCanonical: true },
          { name: "@12", index: 12, tokens: [5, 0], isCanonical: false },
        ],
      },
      1,
    );
    expect(Object.hasOwn(map.tokens, "constructor")).toBe(true);
    expect(map.tokens.constructor).toEqual({ index: 5, szDecimals: 2, pair: "@11" });
  });

  it("throws for a response that does not match", () => {
    expect(() => buildSpotTokenMap({ tokens: [] }, 1)).toThrow();
  });
});

describe("userAbstractionSchema", () => {
  it("parses the three real answers and finds the unified account", () => {
    const raw = fixture("userAbstraction.json");
    if (typeof raw !== "object" || raw === null) throw new Error("Unexpected fixture shape");
    const modes = Object.values(raw).map((value: unknown) => userAbstractionSchema.parse(value));
    expect(modes).toEqual(["unifiedAccount", "disabled", "default"]);
    expect(modes.map(isUnifiedAbstraction)).toEqual([true, false, false]);
  });

  it("treats portfolio margin as unified and an unknown mode as standard", () => {
    expect(isUnifiedAbstraction("portfolioMargin")).toBe(true);
    expect(isUnifiedAbstraction("somethingNew")).toBe(false);
    expect(isUnifiedAbstraction(undefined)).toBe(false);
  });

  it("rejects an empty or non-string answer", () => {
    expect(userAbstractionSchema.safeParse("").success).toBe(false);
    expect(userAbstractionSchema.safeParse({}).success).toBe(false);
  });
});
