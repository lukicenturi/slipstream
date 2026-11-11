import { z } from "zod";

import { normalizeAddress } from "@/lib/address";

/*
 * "My address": the mainnet address that the user saves once on the
 * account page. The value is JSON in localStorage of this browser only.
 * hooks/useMyAddress.ts does the storage work. Everything here is pure.
 */

export const MY_ADDRESS_STORAGE_KEY = "slipstream.myAddress";

export interface MyAddress {
  /** Lower-case address. */
  address: string;
  /** The name the user typed (`name.eth`, `name.hl`), when they saved a name. */
  label?: string;
  /** Time of the save in ms. */
  savedAt: number;
}

const storedSchema = z.object({
  address: z.string().transform((value, ctx) => {
    const address = normalizeAddress(value);
    if (address) return address;
    ctx.addIssue({ code: "custom", message: "Not an address" });
    return z.NEVER;
  }),
  // A bad label is dropped; the address still counts.
  label: z.string().trim().min(1).max(255).optional().catch(undefined),
  savedAt: z.number().refine(Number.isFinite),
});

/** Parse the stored value. A missing value, bad JSON or a bad address gives null. */
export function parseMyAddress(raw: string | null): MyAddress | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = storedSchema.safeParse(json);
  if (!parsed.success) return null;
  const { address, label, savedAt } = parsed.data;
  return label === undefined ? { address, savedAt } : { address, label, savedAt };
}

/**
 * The value to save for an address and an optional name. Returns null when
 * the address is not valid. An empty label is left out.
 */
export function setMyAddress(address: string, label?: string, now = Date.now()): MyAddress | null {
  const lower = normalizeAddress(address);
  if (!lower) return null;
  const name = label?.trim();
  return name ? { address: lower, label: name, savedAt: now } : { address: lower, savedAt: now };
}

/** The value after "Forget": nothing saved. */
export function clearMyAddress(): null {
  return null;
}
