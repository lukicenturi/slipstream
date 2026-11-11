import { connection } from "next/server";
import { z } from "zod";

import { parseSearchInput, type NameKind } from "@/lib/names";
import { resolveEnsName } from "@/lib/names/ens-server";
import { resolveHlName } from "@/lib/names/hl-server";
import type { ResolveError, ResolveResponse } from "@/lib/names/schemas";

/*
 * GET /api/resolve?name=vitalik.eth or ?name=foo.hl
 * Resolves a name to a lower-case address on the server, so the browser
 * never calls the RPC or the HL Names API.
 */

const querySchema = z.object({ name: z.string().min(1).max(300) });

const NO_STORE = { "Cache-Control": "no-store" };

// Log the first failure of each provider until it works again.
const failureLogged: Record<NameKind, boolean> = { ens: false, hl: false };

function errorResponse(status: number, body: ResolveError, cacheControl?: string): Response {
  return Response.json(body, {
    status,
    headers: cacheControl ? { "Cache-Control": cacheControl } : NO_STORE,
  });
}

export async function GET(request: Request): Promise<Response> {
  // cacheComponents is on, so the route segment config `dynamic` is not
  // allowed. connection() makes this handler run at request time instead.
  await connection();

  const query = querySchema.safeParse({
    name: new URL(request.url).searchParams.get("name") ?? undefined,
  });
  if (!query.success) return errorResponse(400, { error: "invalid_name" });

  const input = parseSearchInput(query.data.name);
  if (input.kind !== "ens" && input.kind !== "hl") {
    return errorResponse(400, { error: "invalid_name" });
  }
  const { kind, name } = input;

  let address: string | null;
  try {
    address = kind === "ens" ? await resolveEnsName(name) : await resolveHlName(name);
    failureLogged[kind] = false;
  } catch (error) {
    if (!failureLogged[kind]) {
      failureLogged[kind] = true;
      console.error(`[api/resolve] The ${kind} resolver is not available.`, error);
    }
    return errorResponse(502, { error: "resolver_unavailable", kind });
  }

  if (!address) {
    return errorResponse(404, { error: "name_not_found", name, kind }, "public, s-maxage=300");
  }
  const body: ResolveResponse = { address, name, kind };
  return Response.json(body, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
