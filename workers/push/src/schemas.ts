import { z } from "zod";

/*
 * zod schemas for every boundary of the Worker: request bodies, the
 * Hyperliquid info response and the D1 rows.
 */

export const NETWORKS = ["mainnet", "testnet"] as const;
export type Network = (typeof NETWORKS)[number];
export const networkSchema = z.enum(NETWORKS);

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export const endpointSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "The endpoint must be an https URL");

const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(16).max(256).regex(BASE64URL),
    auth: z.string().min(8).max(64).regex(BASE64URL),
  }),
});

const labelSchema = z
  .string()
  .max(200)
  .nullable()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim().slice(0, 64);
    return trimmed ? trimmed : null;
  });

export const subscribeBodySchema = z.object({
  subscription: pushSubscriptionSchema,
  network: networkSchema,
  addresses: z.array(z.object({ address: z.string().max(64), label: labelSchema })).max(1000),
  minNotionalUsd: z.number().finite().min(0).max(1e12),
});

export type SubscribeBody = z.infer<typeof subscribeBodySchema>;

export const endpointBodySchema = z.object({ endpoint: endpointSchema });

export interface Watch {
  address: string;
  label: string | null;
}

export type WatchListResult =
  | { ok: true; watches: Watch[] }
  | { ok: false; error: "invalid_address" | "too_many_addresses"; message: string };

/**
 * Lower-case the addresses, check them, drop repeats (the first label wins)
 * and enforce the per-subscription limit.
 */
export function normalizeWatches(
  entries: readonly { address: string; label: string | null }[],
  max: number,
): WatchListResult {
  const byAddress = new Map<string, Watch>();
  for (const entry of entries) {
    const address = entry.address.trim().toLowerCase();
    if (!ADDRESS_PATTERN.test(address)) {
      return {
        ok: false,
        error: "invalid_address",
        message: `Not a valid address: ${entry.address.slice(0, 64)}`,
      };
    }
    if (!byAddress.has(address)) byAddress.set(address, { address, label: entry.label });
  }
  if (byAddress.size > max) {
    return {
      ok: false,
      error: "too_many_addresses",
      message: `At most ${max} addresses per subscription`,
    };
  }
  return { ok: true, watches: [...byAddress.values()] };
}

// ---------------------------------------------------------------------------
// Hyperliquid info: userFillsByTime (same fill shape as userFills)
// ---------------------------------------------------------------------------

const numericString = z.string().transform((value, ctx) => {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    ctx.addIssue({ code: "custom", message: "Not a number" });
    return z.NEVER;
  }
  return parsed;
});

export const fillSchema = z
  .object({
    coin: z.string().min(1),
    px: numericString,
    sz: numericString,
    side: z.enum(["A", "B"]),
    time: z.number().int(),
    dir: z.string(),
    closedPnl: numericString,
    oid: z.number().int(),
    tid: z.number().int(),
  })
  .transform((fill) => ({
    ...fill,
    side: fill.side === "B" ? ("buy" as const) : ("sell" as const),
  }));

export type Fill = z.output<typeof fillSchema>;

export const fillsResponseSchema = z.array(z.unknown());

/** Parse a fills response. Bad entries are dropped one by one. */
export function parseFills(value: unknown): Fill[] | null {
  const list = fillsResponseSchema.safeParse(value);
  if (!list.success) return null;
  const fills: Fill[] = [];
  for (const entry of list.data) {
    const fill = fillSchema.safeParse(entry);
    if (fill.success) fills.push(fill.data);
  }
  return fills;
}

// ---------------------------------------------------------------------------
// D1 rows
// ---------------------------------------------------------------------------

export const watchRowSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  network: networkSchema,
  min_notional: z.number(),
  failures: z.number().int(),
  address: z.string(),
  label: z.string().nullable(),
  last_time: z.number().int().nullable(),
  seen_tids: z.string().nullable(),
  polled_at: z.number().int().nullable(),
});

export type WatchRow = z.output<typeof watchRowSchema>;

export const subscriptionRowSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  failures: z.number().int(),
});

export type SubscriptionRow = z.output<typeof subscriptionRowSchema>;

const tidListSchema = z.array(z.number().int());

/** The stored `seen_tids` JSON. Bad JSON gives an empty list. */
export function parseSeenTids(raw: string | null): number[] {
  if (raw === null) return [];
  try {
    const parsed = tidListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
