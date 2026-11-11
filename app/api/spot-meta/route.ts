import { connection } from "next/server";

import { getSpotTokenMapServer } from "@/lib/hyperliquid/spot-meta-server";

let failureLogged = false;

/** The trimmed spot token map of this build's network (never the raw spotMeta). */
export async function GET(): Promise<Response> {
  // cacheComponents is on, so connection() makes this handler run at request time.
  await connection();

  try {
    const data = await getSpotTokenMapServer();
    failureLogged = false;
    return Response.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600" },
    });
  } catch (error) {
    if (!failureLogged) {
      failureLogged = true;
      console.error("[api/spot-meta] The spot metadata is not available.", error);
    }
    return Response.json(
      { error: "spot_meta_unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
