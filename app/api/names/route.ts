import { connection } from "next/server";

import { uniqueAddresses } from "@/lib/names";
import { lookupEnsNames } from "@/lib/names/ens-server";
import { lookupHlNames } from "@/lib/names/hl-server";
import type { NameLookup } from "@/lib/names/lookup";
import { namesRequestSchema, type NamesResponse, type TraderNames } from "@/lib/names/schemas";

/*
 * POST /api/names with { addresses: string[] } (at most 120).
 * Returns the .hl and ENS primary names of the addresses. Names are best
 * effort: when one provider fails, the response holds what the other one
 * found and `partial` is true.
 */

const NO_STORE = { "Cache-Control": "no-store" };

function lookupOf(result: PromiseSettledResult<NameLookup>): NameLookup {
  if (result.status === "fulfilled") return result.value;
  console.error("[api/names] A name provider failed.", result.reason);
  return { names: new Map(), complete: false };
}

export async function POST(request: Request): Promise<Response> {
  await connection();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }
  const parsed = namesRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }

  const addresses = uniqueAddresses(parsed.data.addresses);
  const [hlResult, ensResult] = await Promise.allSettled([
    lookupHlNames(addresses),
    lookupEnsNames(addresses),
  ]);
  const hl = lookupOf(hlResult);
  const ens = lookupOf(ensResult);

  const names: Record<string, TraderNames> = {};
  for (const address of addresses) {
    const hlName = hl.names.get(address);
    const ensName = ens.names.get(address);
    if (!hlName && !ensName) continue;
    names[address] = {
      ...(hlName ? { hl: hlName } : {}),
      ...(ensName ? { ens: ensName } : {}),
    };
  }

  const body: NamesResponse = { names, partial: !hl.complete || !ens.complete };
  return Response.json(body, { headers: NO_STORE });
}
