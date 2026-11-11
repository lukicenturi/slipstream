import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LeaderboardShapeError, trimLeaderboard } from "./leaderboard-trim";

interface RawRow {
  ethAddress: string;
  windowPerformances: [string, { pnl: string; roi: string; vlm: string }][];
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "leaderboard.json"), "utf8"),
) as { leaderboardRows: RawRow[] };

/** Build n valid rows with month PnL equal to the index. */
function rows(n: number): RawRow[] {
  const template = fixture.leaderboardRows[0];
  if (!template) throw new Error("Empty fixture");
  return Array.from({ length: n }, (_, i) => ({
    ...template,
    ethAddress: `0x${i.toString(16).padStart(40, "0")}`,
    windowPerformances: template.windowPerformances.map(([name, perf]) =>
      name === "month" ? [name, { ...perf, pnl: String(i) }] : [name, perf],
    ),
  }));
}

describe("trimLeaderboard", () => {
  it("sorts by month PnL and keeps the limit", () => {
    const result = trimLeaderboard({ leaderboardRows: rows(30) }, 123, 5);
    expect(result.updatedAt).toBe(123);
    expect(result.rows.map((r) => r.windows.month.pnl)).toEqual([29, 28, 27, 26, 25]);
  });

  it("skips rows that fail the schema", () => {
    const input = { leaderboardRows: [...rows(12), { ethAddress: "bad" }, null] };
    expect(trimLeaderboard(input, 0).rows).toHaveLength(12);
  });

  it("throws when the envelope shape changes", () => {
    expect(() => trimLeaderboard({ rows: [] }, 0)).toThrow(LeaderboardShapeError);
  });

  it("throws when fewer than 10 rows parse", () => {
    expect(() => trimLeaderboard({ leaderboardRows: rows(9) }, 0)).toThrow(LeaderboardShapeError);
  });
});
