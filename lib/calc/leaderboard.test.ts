import { describe, expect, it } from "vitest";

import type { LeaderboardEntry } from "@/lib/hyperliquid/schemas";

import { nextSort, rankLeaderboard, topAddressesByMonthPnl } from "./leaderboard";

function entry(
  address: string,
  accountValue: number,
  day: number,
  month: number,
): LeaderboardEntry {
  const perf = (pnl: number) => ({ pnl, roi: pnl / 1000, vlm: 0 });
  return {
    address,
    displayName: null,
    accountValue,
    windows: { day: perf(day), week: perf(0), month: perf(month), allTime: perf(0) },
  };
}

const rows = [entry("0xa", 300, -5, 100), entry("0xb", 100, 50, 300), entry("0xc", 200, 10, 200)];

describe("rankLeaderboard", () => {
  it("ranks by PnL of the chosen window", () => {
    const ranked = rankLeaderboard(rows, "day", { key: "pnl", direction: "desc" });
    expect(ranked.map((row) => [row.rank, row.entry.address])).toEqual([
      [1, "0xb"],
      [2, "0xc"],
      [3, "0xa"],
    ]);
  });

  it("sorts by another column and keeps the PnL rank", () => {
    const ranked = rankLeaderboard(rows, "month", { key: "accountValue", direction: "asc" });
    expect(ranked.map((row) => [row.rank, row.entry.address])).toEqual([
      [1, "0xb"],
      [2, "0xc"],
      [3, "0xa"],
    ]);
    const byRoi = rankLeaderboard(rows, "day", { key: "roi", direction: "asc" });
    expect(byRoi.map((row) => row.entry.address)).toEqual(["0xa", "0xc", "0xb"]);
  });
});

describe("nextSort", () => {
  it("flips the same column and starts a new column descending", () => {
    expect(nextSort({ key: "pnl", direction: "desc" }, "pnl")).toEqual({
      key: "pnl",
      direction: "asc",
    });
    expect(nextSort({ key: "pnl", direction: "asc" }, "roi")).toEqual({
      key: "roi",
      direction: "desc",
    });
  });
});

describe("topAddressesByMonthPnl", () => {
  it("returns the top addresses by month PnL", () => {
    expect(topAddressesByMonthPnl(rows, 2)).toEqual(["0xb", "0xc"]);
  });
});
