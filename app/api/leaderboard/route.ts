import { connection } from "next/server";

import { getTopLeaderboard } from "@/lib/hyperliquid/leaderboard-server";

// The raw download can take several seconds.
export const maxDuration = 60;

let failureLogged = false;

export async function GET(): Promise<Response> {
  // cacheComponents is on, so the route segment config `dynamic` is not
  // allowed. connection() makes this handler run at request time instead.
  await connection();

  try {
    const data = await getTopLeaderboard();
    failureLogged = false;
    return Response.json(data, {
      headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=600" },
    });
  } catch (error) {
    if (!failureLogged) {
      failureLogged = true;
      console.error("[api/leaderboard] The leaderboard is not available.", error);
    }
    return Response.json(
      { error: "leaderboard_unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
