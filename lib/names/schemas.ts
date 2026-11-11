import { z } from "zod";

import { addressSchema } from "@/lib/hyperliquid/schemas";

/*
 * Zod schemas for name resolution.
 * - The HL Names REST API (https://api.hlnames.xyz). Shapes come from the
 *   real responses in fixtures/hlnames-*.json.
 * - The bodies of our own routes, /api/resolve and /api/names, which the
 *   browser validates.
 */

/** HL Names returns this address when a name exists but has no address set. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// HL Names upstream
// ---------------------------------------------------------------------------

/** GET /resolve/address/{name}. The address keeps its checksum case. */
export const hlResolveSchema = z.object({ address: addressSchema });

/** GET /resolve/primary_name/{address}. An empty string means no primary name. */
export const hlPrimaryNameSchema = z.object({ primaryName: z.string() });

/** POST /utils/all_primary_names. Only addresses with a primary name come back. */
export const hlBulkPrimaryNamesSchema = z.array(
  z.object({
    address: addressSchema,
    primaryName: z.string(),
  }),
);

/** The error body, for example 404 "Name is not registered". */
export const hlErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    status: z.number(),
    details: z.string().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Our routes
// ---------------------------------------------------------------------------

export const nameKindSchema = z.enum(["ens", "hl"]);

/** 200 body of GET /api/resolve. */
export const resolveResponseSchema = z.object({
  address: addressSchema,
  name: z.string(),
  kind: nameKindSchema,
});
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;

/** Error body of GET /api/resolve (400, 404, 502). */
export const resolveErrorSchema = z.object({
  error: z.enum(["invalid_name", "name_not_found", "resolver_unavailable"]),
  name: z.string().optional(),
  kind: nameKindSchema.optional(),
});
export type ResolveError = z.infer<typeof resolveErrorSchema>;

/** The most addresses that one POST /api/names accepts. */
export const MAX_NAME_LOOKUP = 120;

/** Body of POST /api/names. */
export const namesRequestSchema = z.object({
  addresses: z.array(addressSchema).max(MAX_NAME_LOOKUP),
});

const lowerAddressKey = z.string().regex(/^0x[0-9a-f]{40}$/, "Not a lower-case address");

export const traderNamesSchema = z.object({
  hl: z.string().optional(),
  ens: z.string().optional(),
});
export type TraderNames = z.infer<typeof traderNamesSchema>;

/** 200 body of POST /api/names. Only addresses with at least one name appear. */
export const namesResponseSchema = z.object({
  names: z.record(lowerAddressKey, traderNamesSchema),
  partial: z.boolean(),
});
export type NamesResponse = z.infer<typeof namesResponseSchema>;
