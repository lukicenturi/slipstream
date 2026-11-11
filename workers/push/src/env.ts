import { z } from "zod";

/** The bindings, vars and secrets of the Worker (wrangler.jsonc and `wrangler secret put`). */
export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  MAX_ADDRESSES_PER_SUBSCRIPTION?: string;
  MAX_ADDRESSES_PER_TICK?: string;
  MAX_SUBREQUESTS_PER_TICK?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ADMIN_TOKEN?: string;
}

export interface Config {
  allowedOrigins: readonly string[];
  maxAddressesPerSubscription: number;
  maxAddressesPerTick: number;
  /**
   * Outgoing fetches (info calls and pushes) per tick. Workers Free allows
   * 50 subrequests per invocation, and D1 queries count too. A tick makes
   * 3 D1 calls, so the default leaves room for them.
   */
  maxSubrequestsPerTick: number;
}

function positiveInt(fallback: number) {
  return z.coerce.number().int().positive().catch(fallback);
}

const configSchema = z.object({
  ALLOWED_ORIGINS: z.string().catch(""),
  MAX_ADDRESSES_PER_SUBSCRIPTION: positiveInt(50),
  MAX_ADDRESSES_PER_TICK: positiveInt(300),
  MAX_SUBREQUESTS_PER_TICK: positiveInt(45),
});

/** Split a comma-separated origin list. Blank entries and trailing slashes are dropped. */
export function parseOrigins(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => entry.length > 0);
}

/** Read the vars. A missing or bad value gives its default. */
export function readConfig(env: Env): Config {
  const parsed = configSchema.parse({
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
    MAX_ADDRESSES_PER_SUBSCRIPTION: env.MAX_ADDRESSES_PER_SUBSCRIPTION,
    MAX_ADDRESSES_PER_TICK: env.MAX_ADDRESSES_PER_TICK,
    MAX_SUBREQUESTS_PER_TICK: env.MAX_SUBREQUESTS_PER_TICK,
  });
  return {
    allowedOrigins: parseOrigins(parsed.ALLOWED_ORIGINS),
    maxAddressesPerSubscription: parsed.MAX_ADDRESSES_PER_SUBSCRIPTION,
    maxAddressesPerTick: parsed.MAX_ADDRESSES_PER_TICK,
    maxSubrequestsPerTick: parsed.MAX_SUBREQUESTS_PER_TICK,
  };
}

export interface Vapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** The VAPID keys, or null when a secret is missing. */
export function readVapid(env: Env): Vapid | null {
  const subject = env.VAPID_SUBJECT?.trim();
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}
