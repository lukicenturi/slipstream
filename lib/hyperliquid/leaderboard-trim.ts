import {
  rawLeaderboardEnvelopeSchema,
  rawLeaderboardRowSchema,
  type LeaderboardEntry,
  type LeaderboardResponse,
} from "./schemas";

/** The number of rows that the API route keeps. */
export const LEADERBOARD_LIMIT = 100;

/** Fewer parsed rows than this means that the file shape changed. */
export const LEADERBOARD_MIN_ROWS = 10;

export class LeaderboardShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaderboardShapeError";
  }
}

/**
 * Trim the raw leaderboard file to the top rows by month PnL.
 * Each row is checked on its own; rows that fail the schema are skipped.
 * This is a pure function, so it can run in tests without Next.js.
 */
export function trimLeaderboard(
  raw: unknown,
  now: number,
  limit: number = LEADERBOARD_LIMIT,
): LeaderboardResponse {
  const envelope = rawLeaderboardEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new LeaderboardShapeError("The leaderboard envelope does not match the schema");
  }

  const rows: LeaderboardEntry[] = [];
  for (const candidate of envelope.data.leaderboardRows) {
    const parsed = rawLeaderboardRowSchema.safeParse(candidate);
    if (parsed.success) rows.push(parsed.data);
  }

  if (rows.length < LEADERBOARD_MIN_ROWS) {
    throw new LeaderboardShapeError(`Only ${rows.length} leaderboard rows parsed`);
  }

  rows.sort((a, b) => b.windows.month.pnl - a.windows.month.pnl);
  return { updatedAt: now, rows: rows.slice(0, limit) };
}
