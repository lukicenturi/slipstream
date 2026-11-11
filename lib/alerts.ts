import { z } from "zod";

import type { FeedItem } from "@/lib/calc/aggregateFills";
import { isSystemFill } from "@/lib/calc/fillAction";
import { normalizeAddress } from "@/lib/address";

/*
 * Alert settings for the watchlist. The value is JSON in localStorage.
 * hooks/useAlertSettings.ts does the storage work. A bad field falls back
 * to its default, so one broken value does not reset the other settings.
 */

export const ALERTS_STORAGE_KEY = "slipstream.alerts";

export const MIN_NOTIONAL_OPTIONS = [0, 1_000, 10_000, 100_000] as const;
export type MinNotionalUsd = (typeof MIN_NOTIONAL_OPTIONS)[number];

export interface GlobalAlertSettings {
  /** Browser notifications through the Notification API (tab hidden only). */
  browser: boolean;
  /** Trades below this notional (USD) do not notify. */
  minNotionalUsd: MinNotionalUsd;
  /** In-app toasts. */
  toasts: boolean;
}

export interface AlertSettings {
  version: 1;
  global: GlobalAlertSettings;
  /** Lower-case address -> alert state. A missing address is enabled. */
  perAddress: Readonly<Record<string, { enabled: boolean }>>;
}

export const DEFAULT_GLOBAL_ALERTS: GlobalAlertSettings = {
  browser: false,
  minNotionalUsd: 0,
  toasts: true,
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  version: 1,
  global: DEFAULT_GLOBAL_ALERTS,
  perAddress: {},
};

const minNotionalSchema = z.union([
  z.literal(0),
  z.literal(1_000),
  z.literal(10_000),
  z.literal(100_000),
]);

const globalSchema = z.object({
  browser: z.boolean().catch(DEFAULT_GLOBAL_ALERTS.browser),
  minNotionalUsd: minNotionalSchema.catch(DEFAULT_GLOBAL_ALERTS.minNotionalUsd),
  toasts: z.boolean().catch(DEFAULT_GLOBAL_ALERTS.toasts),
});

const storedSchema = z.object({
  version: z.literal(1),
  global: z.unknown(),
  perAddress: z.unknown(),
});

const perAddressSchema = z.record(z.string(), z.unknown());
const addressEntrySchema = z.object({ enabled: z.boolean() });

function parseGlobal(value: unknown): GlobalAlertSettings {
  const parsed = globalSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_GLOBAL_ALERTS;
}

function parsePerAddress(value: unknown): Record<string, { enabled: boolean }> {
  const parsed = perAddressSchema.safeParse(value);
  if (!parsed.success) return {};
  const result: Record<string, { enabled: boolean }> = {};
  for (const [key, entry] of Object.entries(parsed.data)) {
    const address = normalizeAddress(key);
    const state = addressEntrySchema.safeParse(entry);
    if (address && state.success) result[address] = { enabled: state.data.enabled };
  }
  return result;
}

/**
 * Parse the stored value. A missing value, bad JSON or another version
 * gives the defaults. Bad fields fall back one by one.
 */
export function parseAlertSettings(raw: string | null): AlertSettings {
  if (raw === null) return DEFAULT_ALERT_SETTINGS;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
  const parsed = storedSchema.safeParse(json);
  if (!parsed.success) return DEFAULT_ALERT_SETTINGS;
  return {
    version: 1,
    global: parseGlobal(parsed.data.global),
    perAddress: parsePerAddress(parsed.data.perAddress),
  };
}

/** True when alerts are on for this address. Every address starts enabled. */
export function isAlertEnabled(settings: AlertSettings, address: string): boolean {
  return settings.perAddress[address.toLowerCase()]?.enabled ?? true;
}

/** Turn the alerts of one address on or off. Returns new settings. */
export function setAddressAlert(
  settings: AlertSettings,
  address: string,
  enabled: boolean,
): AlertSettings {
  return {
    ...settings,
    perAddress: { ...settings.perAddress, [address.toLowerCase()]: { enabled } },
  };
}

/** Change one or more global settings. Returns new settings. */
export function setGlobal(
  settings: AlertSettings,
  patch: Partial<GlobalAlertSettings>,
): AlertSettings {
  return { ...settings, global: { ...settings.global, ...patch } };
}

/**
 * True when a feed item must create a notice: it arrived live (snapshot
 * items never notify), its trader is watched with alerts on, the exchange
 * did not create it, and its notional reaches the minimum size.
 */
export function shouldNotify({
  item,
  settings,
  watched,
}: {
  item: Pick<FeedItem, "live" | "user" | "dir" | "notional">;
  settings: AlertSettings;
  /** Lower-case watched addresses. */
  watched: readonly string[];
}): boolean {
  if (!item.live) return false;
  const user = item.user.toLowerCase();
  if (!watched.includes(user)) return false;
  if (!isAlertEnabled(settings, user)) return false;
  if (isSystemFill(item.dir)) return false;
  return item.notional >= settings.global.minNotionalUsd;
}
