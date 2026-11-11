import { z } from "zod";

import { isAlertEnabled, type AlertSettings, type MinNotionalUsd } from "@/lib/alerts";
import type { DisplayName } from "@/lib/names";
import type { Network } from "@/lib/network";

/*
 * Web Push alerts: pure helpers. The push Worker (workers/push) watches the
 * tracked addresses once a minute and sends the pushes; public/sw.js shows
 * them. hooks/usePushAlerts.ts does the browser work.
 */

export const PUSH_STORAGE_KEY = "slipstream.push";

/** The Worker accepts at most this many addresses per subscription. */
export const PUSH_MAX_ADDRESSES = 50;

/** The service worker reads the last subscription body from this cache entry. */
export const PUSH_PAYLOAD_CACHE = "slipstream-push-v1";
export const PUSH_PAYLOAD_KEY = "/__slipstream/push-payload";

/** Keep only the origin of an http(s) URL. Anything else is null. */
export function parsePushApiUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

// Next inlines NEXT_PUBLIC_ variables only for these literal expressions.
export const PUSH_API_URL = parsePushApiUrl(process.env.NEXT_PUBLIC_PUSH_API_URL);
export const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
/** Push alerts need both variables at build time. */
export const PUSH_CONFIGURED = PUSH_API_URL !== null && VAPID_PUBLIC_KEY.length > 0;

/** The registration URL of the service worker, with the values that it needs. */
export function serviceWorkerUrl(apiUrl: string, vapidKey: string): string {
  return `/sw.js?api=${encodeURIComponent(apiUrl)}&vapid=${encodeURIComponent(vapidKey)}`;
}

/** Decode a base64url VAPID key into bytes for `applicationServerKey`. */
export function urlBase64ToUint8Array(key: string): Uint8Array<ArrayBuffer> {
  const padded = `${key}${"=".repeat((4 - (key.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** True when two keys hold the same bytes. */
export function sameKey(a: ArrayBuffer | Uint8Array | null, b: Uint8Array): boolean {
  if (a === null) return false;
  const left = a instanceof Uint8Array ? a : new Uint8Array(a);
  if (left.length !== b.length) return false;
  return left.every((byte, index) => byte === b[index]);
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type PushAvailability = "unsupported" | "needs-install" | "not-configured" | "available";

/**
 * Whether push alerts can work here. A deployment without the variables is
 * "not-configured". iPhone and iPad Safari support push only for a web app
 * on the Home Screen, so a Safari tab there is "needs-install".
 */
export function pushAvailability({
  hasServiceWorker,
  hasPushManager,
  hasNotification,
  isIos,
  isStandalone,
  configured,
}: {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIos: boolean;
  isStandalone: boolean;
  configured: boolean;
}): PushAvailability {
  if (!configured) return "not-configured";
  if (isIos && !isStandalone) return "needs-install";
  if (!hasServiceWorker || !hasPushManager || !hasNotification) return "unsupported";
  return "available";
}

/** iPhone, iPod, or an iPad that reports itself as a Mac. */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

// ---------------------------------------------------------------------------
// Subscription body
// ---------------------------------------------------------------------------

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushWatch {
  address: string;
  label?: string;
}

export interface SubscriptionPayload {
  subscription: PushSubscriptionJson;
  network: Network;
  addresses: PushWatch[];
  minNotionalUsd: MinNotionalUsd;
}

/** The body without the subscription: what the service worker keeps for a renewal. */
export type WatchPayload = Omit<SubscriptionPayload, "subscription">;

/** The tracked addresses with alerts on, lower-case, without repeats. */
export function pushAddresses(
  watchlist: readonly string[],
  perAddress: AlertSettings["perAddress"],
): string[] {
  const settings: AlertSettings = {
    version: 1,
    global: { browser: false, minNotionalUsd: 0, toasts: true },
    perAddress,
  };
  const seen = new Set<string>();
  for (const entry of watchlist) {
    const address = entry.toLowerCase();
    if (isAlertEnabled(settings, address)) seen.add(address);
  }
  return [...seen];
}

/**
 * The watch part of the API body: the first 50 tracked addresses with alerts
 * on, with a label only when it is a name (not a short address).
 */
export function buildWatchPayload({
  network,
  watchlist,
  perAddress,
  labels,
  minNotionalUsd,
}: {
  network: Network;
  watchlist: readonly string[];
  perAddress: AlertSettings["perAddress"];
  labels: (address: string) => DisplayName;
  minNotionalUsd: MinNotionalUsd;
}): WatchPayload {
  const addresses = pushAddresses(watchlist, perAddress)
    .slice(0, PUSH_MAX_ADDRESSES)
    .map((address): PushWatch => {
      const label = labels(address);
      return label.source === "address" ? { address } : { address, label: label.label };
    });
  return { network, addresses, minNotionalUsd };
}

/** The full API body for POST /subscriptions. */
export function buildSubscriptionPayload(
  input: Parameters<typeof buildWatchPayload>[0] & { subscription: PushSubscriptionJson },
): SubscriptionPayload {
  const { subscription, ...rest } = input;
  return {
    subscription: {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    },
    ...buildWatchPayload(rest),
  };
}

/**
 * A short stable key of a body, to skip a sync when nothing changed.
 * The addresses are sorted, so the order of the watchlist does not matter.
 */
export function payloadKey(payload: SubscriptionPayload): string {
  const stable = JSON.stringify([
    payload.subscription.endpoint,
    payload.subscription.keys.p256dh,
    payload.subscription.keys.auth,
    payload.network,
    payload.minNotionalUsd,
    [...payload.addresses]
      .sort((a, b) => a.address.localeCompare(b.address))
      .map((watch) => [watch.address, watch.label ?? null]),
  ]);
  // FNV-1a, 32 bit. Collisions only cost one skipped sync.
  let hash = 0x811c9dc5;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${stable.length.toString(36)}-${hash.toString(36)}`;
}

/** The PushSubscription JSON from the browser, checked. */
export const pushSubscriptionJsonSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

export const subscribeResponseSchema = z.object({ id: z.string(), addresses: z.number() });
export const deleteResponseSchema = z.object({ removed: z.boolean() });
export const testResponseSchema = z.object({ sent: z.boolean(), status: z.number() });
export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Stored state
// ---------------------------------------------------------------------------

export interface PushState {
  enabled: boolean;
  /** The endpoint that the Worker knows. */
  endpoint: string | null;
  /** Time of the last successful sync (ms). */
  syncedAt: number | null;
  /** payloadKey of the last synced body. */
  syncedKey: string | null;
}

export const DEFAULT_PUSH_STATE: PushState = {
  enabled: false,
  endpoint: null,
  syncedAt: null,
  syncedKey: null,
};

const pushStateSchema = z.object({
  enabled: z.boolean().catch(false),
  endpoint: z.string().nullable().catch(null),
  syncedAt: z.number().nullable().catch(null),
  syncedKey: z.string().nullable().optional().catch(null),
});

/** Parse the stored state. A missing value or bad JSON gives the defaults. */
export function parsePushState(raw: string | null): PushState {
  if (raw === null) return DEFAULT_PUSH_STATE;
  try {
    const parsed = pushStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_PUSH_STATE;
    return { ...parsed.data, syncedKey: parsed.data.syncedKey ?? null };
  } catch {
    return DEFAULT_PUSH_STATE;
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_EXPIRED_MESSAGE = "Push subscription expired. Turn it on again.";

/** A short message for a failure of the browser push calls. */
export function pushErrorMessage(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Notifications are blocked. Allow them in the browser settings.";
    case "AbortError":
      return "The browser push service did not respond. Try again later.";
    case "InvalidStateError":
      return "The browser has an old push subscription. Turn it off and on again.";
    case "NotSupportedError":
      return "Push is not supported in this browser.";
    case "PushApiError":
      return error instanceof Error && error.message ? error.message : "The push server failed.";
    case "TypeError":
      return "Could not reach the push server. Try again later.";
    default:
      return "Could not turn on push alerts. Try again later.";
  }
}
