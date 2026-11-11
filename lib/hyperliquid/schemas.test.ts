import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  allMidsMessageSchema,
  clearinghouseStateSchema,
  numericString,
  parseWsMessage,
  portfolioSchema,
  rawLeaderboardEnvelopeSchema,
  rawLeaderboardRowSchema,
  userFillsMessageSchema,
  userFillsSchema,
} from "./schemas";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));
}

describe("numericString", () => {
  it("parses decimal strings", () => {
    expect(numericString.parse("93174274.9546110034")).toBeCloseTo(93174274.95, 2);
    expect(numericString.parse("-0.0011310428")).toBeCloseTo(-0.0011310428);
  });

  it("rejects empty and non-numeric strings", () => {
    expect(numericString.safeParse("").success).toBe(false);
    expect(numericString.safeParse("abc").success).toBe(false);
    expect(numericString.safeParse("Infinity").success).toBe(false);
  });
});

describe("leaderboard fixture", () => {
  const envelope = rawLeaderboardEnvelopeSchema.parse(fixture("leaderboard.json"));

  it("parses every row into numbers", () => {
    expect(envelope.leaderboardRows.length).toBeGreaterThan(0);
    for (const row of envelope.leaderboardRows) {
      const entry = rawLeaderboardRowSchema.parse(row);
      expect(entry.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(typeof entry.accountValue).toBe("number");
      expect(typeof entry.windows.month.pnl).toBe("number");
      expect(typeof entry.windows.allTime.vlm).toBe("number");
    }
  });

  it("keeps a display name when one exists", () => {
    const names = envelope.leaderboardRows.map(
      (row) => rawLeaderboardRowSchema.parse(row).displayName,
    );
    expect(names).toContain(null);
    expect(names.some((name) => typeof name === "string")).toBe(true);
  });

  it("rejects a row that has no month window", () => {
    const row = envelope.leaderboardRows[0];
    if (typeof row !== "object" || row === null || !("windowPerformances" in row)) {
      throw new Error("Unexpected fixture shape");
    }
    const broken = { ...row, windowPerformances: [] };
    expect(rawLeaderboardRowSchema.safeParse(broken).success).toBe(false);
  });
});

describe("clearinghouseState fixtures", () => {
  it("parses a cross-margin account", () => {
    const state = clearinghouseStateSchema.parse(fixture("clearinghouseState.json"));
    expect(state.positions.length).toBeGreaterThan(0);
    const btc = state.positions.find((p) => p.coin === "BTC");
    expect(btc).toBeDefined();
    expect(btc?.leverageType).toBe("cross");
    expect(btc?.side).toBe(btc && btc.size < 0 ? "short" : "long");
    expect(typeof state.accountValue).toBe("number");
  });

  it("parses isolated positions, shorts and liquidation prices", () => {
    const state = clearinghouseStateSchema.parse(fixture("clearinghouseState-isolated.json"));
    const isolated = state.positions.find((p) => p.leverageType === "isolated");
    expect(isolated?.side).toBe("short");
    expect(isolated?.size).toBeLessThan(0);
    expect(typeof isolated?.liquidationPx).toBe("number");
  });

  it("parses an empty account", () => {
    const state = clearinghouseStateSchema.parse(fixture("clearinghouseState-empty.json"));
    expect(state.positions).toEqual([]);
    expect(state.accountValue).toBeCloseTo(0.1);
  });
});

describe("userFills fixture", () => {
  it("parses every fill", () => {
    const fills = userFillsSchema.parse(fixture("userFills.json"));
    expect(fills).toHaveLength(50);
    for (const fill of fills) {
      expect(["buy", "sell"]).toContain(fill.side);
      expect(typeof fill.px).toBe("number");
      expect(typeof fill.closedPnl).toBe("number");
      expect(Number.isSafeInteger(fill.tid)).toBe(true);
    }
  });
});

describe("portfolio fixture", () => {
  it("parses the four windows into time points", () => {
    const portfolio = portfolioSchema.parse(fixture("portfolio.json"));
    for (const window of ["day", "week", "month", "allTime"] as const) {
      expect(portfolio[window].pnlHistory.length).toBeGreaterThan(0);
      const [first] = portfolio[window].pnlHistory;
      expect(typeof first?.time).toBe("number");
      expect(typeof first?.value).toBe("number");
    }
  });
});

describe("WebSocket fixtures", () => {
  it("parses allMids and drops spot and builder keys", () => {
    const message = allMidsMessageSchema.parse(fixture("ws-allMids.json"));
    expect(Object.keys(message.mids)).toHaveLength(10);
    expect(typeof message.mids.BTC).toBe("number");
    expect(message.mids["@1"]).toBeUndefined();
    expect(message.mids["#114910"]).toBeUndefined();
  });

  it("parses a userFills snapshot and a live message", () => {
    const raw = fixture("ws-userFills.json");
    if (!Array.isArray(raw)) throw new Error("Unexpected fixture shape");
    const [snapshot, live] = raw.map((item: unknown) => userFillsMessageSchema.parse(item));
    expect(snapshot?.isSnapshot).toBe(true);
    expect(live?.isSnapshot).toBe(false);
    expect(live?.fills.length).toBeGreaterThan(0);
    expect(live?.user).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("routes every fixture message through parseWsMessage", () => {
    const control = fixture("ws-control.json");
    if (!Array.isArray(control)) throw new Error("Unexpected fixture shape");
    const channels = control.map((item: unknown) => parseWsMessage(item)?.channel);
    expect(channels).toEqual(["subscriptionResponse", "pong"]);
    expect(parseWsMessage(fixture("ws-allMids.json"))?.channel).toBe("allMids");
  });

  it("maps unknown channels to the fallback and rejects invalid known channels", () => {
    expect(parseWsMessage({ channel: "trades", data: [] })).toEqual({
      channel: "unknown",
      originalChannel: "trades",
    });
    expect(parseWsMessage({ channel: "allMids", data: {} })).toBeNull();
    expect(parseWsMessage("not an object")).toBeNull();
  });
});
