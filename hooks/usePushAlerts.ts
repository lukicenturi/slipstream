"use client";

import { useSyncExternalStore } from "react";
import type { z } from "zod";

import type { AlertSettings, MinNotionalUsd } from "@/lib/alerts";
import type { DisplayName } from "@/lib/names";
import { NETWORK } from "@/lib/network";
import {
  buildSubscriptionPayload,
  DEFAULT_PUSH_STATE,
  deleteResponseSchema,
  errorResponseSchema,
  isIosDevice,
  parsePushState,
  payloadKey,
  PUSH_API_URL,
  PUSH_CONFIGURED,
  PUSH_MAX_ADDRESSES,
  PUSH_PAYLOAD_CACHE,
  PUSH_PAYLOAD_KEY,
  PUSH_STORAGE_KEY,
  pushAddresses,
  pushAvailability,
  pushErrorMessage,
  pushSubscriptionJsonSchema,
  sameKey,
  serviceWorkerUrl,
  subscribeResponseSchema,
  SUBSCRIPTION_EXPIRED_MESSAGE,
  testResponseSchema,
  urlBase64ToUint8Array,
  VAPID_PUBLIC_KEY,
  type PushAvailability,
  type PushState,
  type SubscriptionPayload,
  type WatchPayload,
} from "@/lib/push";

import { createLocalStore } from "./createLocalStore";
import { refreshBrowserPermission } from "./useBrowserNotifications";

/*
 * Web Push alerts. The persisted part (`slipstream.push`) says whether push
 * is on and which endpoint the Worker knows. The runtime part (busy, error,
 * test result) lives only in memory. Every browser call is in try/catch;
 * the functions here never throw.
 */

export type PushStatus =
  "unsupported" | "needs-install" | "not-configured" | "off" | "enabling" | "on" | "error";

export const pushStateStore = createLocalStore<PushState>(
  PUSH_STORAGE_KEY,
  parsePushState,
  DEFAULT_PUSH_STATE,
);

interface Runtime {
  busy: boolean;
  error: string | null;
  test: { pending: boolean; message: string | null };
}

const INITIAL_RUNTIME: Runtime = {
  busy: false,
  error: null,
  test: { pending: false, message: null },
};
let runtime: Runtime = INITIAL_RUNTIME;
const runtimeListeners = new Set<() => void>();

function setRuntime(patch: Partial<Runtime>): void {
  runtime = { ...runtime, ...patch };
  for (const listener of [...runtimeListeners]) listener();
}

function subscribeRuntime(listener: () => void): () => void {
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

function setState(patch: Partial<PushState>): void {
  pushStateStore.update((current) => ({ ...current, ...patch }));
}

// ---------------------------------------------------------------------------
// Inputs: PushSync keeps the latest watchlist, settings and labels here
// ---------------------------------------------------------------------------

export interface PushInputs {
  watchlist: readonly string[];
  perAddress: AlertSettings["perAddress"];
  minNotionalUsd: MinNotionalUsd;
  labels: (address: string) => DisplayName;
}

let inputs: PushInputs | null = null;

export function setPushInputs(next: PushInputs): void {
  inputs = next;
}

function currentPayload(subscription: PushSubscription): SubscriptionPayload | null {
  if (!inputs) return null;
  const json = pushSubscriptionJsonSchema.safeParse(subscription.toJSON());
  if (!json.success) return null;
  return buildSubscriptionPayload({
    subscription: json.data,
    network: NETWORK,
    watchlist: inputs.watchlist,
    perAddress: inputs.perAddress,
    labels: inputs.labels,
    minNotionalUsd: inputs.minNotionalUsd,
  });
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

function readAvailability(): PushAvailability {
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return pushAvailability({
      hasServiceWorker: "serviceWorker" in nav,
      hasPushManager: "PushManager" in window,
      hasNotification: "Notification" in window,
      isIos: isIosDevice(nav.userAgent, nav.platform, nav.maxTouchPoints),
      isStandalone:
        nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches,
      configured: PUSH_CONFIGURED,
    });
  } catch {
    return PUSH_CONFIGURED ? "unsupported" : "not-configured";
  }
}

function serverAvailability(): PushAvailability {
  return PUSH_CONFIGURED ? "available" : "not-configured";
}

function noop(): () => void {
  return () => {};
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

class PushApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushApiError";
  }
}

async function callApi<S extends z.ZodType>(
  path: string,
  method: "POST" | "DELETE",
  body: unknown,
  schema: S,
): Promise<z.output<S>> {
  if (!PUSH_API_URL) throw new PushApiError("Push alerts are not set up on this deployment.");
  const response = await fetch(`${PUSH_API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // A body that is not JSON. The status below decides.
  }
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(json);
    throw new PushApiError(
      error.success && error.data.message
        ? error.data.message
        : `The push server answered ${response.status}.`,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new PushApiError("The push server sent an unexpected answer.");
  return parsed.data;
}

/** Keep the watch part for the service worker, so a renewed subscription keeps its watches. */
async function storeForWorker(payload: SubscriptionPayload | null): Promise<void> {
  try {
    if (!("caches" in window)) return;
    const cache = await caches.open(PUSH_PAYLOAD_CACHE);
    if (payload === null) {
      await cache.delete(PUSH_PAYLOAD_KEY);
      return;
    }
    const { subscription: _subscription, ...watch } = payload;
    void _subscription;
    const body: WatchPayload = watch;
    await cache.put(PUSH_PAYLOAD_KEY, new Response(JSON.stringify(body)));
  } catch {
    // Without the cache entry, the app syncs again on the next start.
  }
}

async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration("/")) ?? null;
  } catch {
    return null;
  }
}

async function postPayload(payload: SubscriptionPayload): Promise<void> {
  await callApi("/subscriptions", "POST", payload, subscribeResponseSchema);
  const previous = pushStateStore.getSnapshot().endpoint;
  setState({
    enabled: true,
    endpoint: payload.subscription.endpoint,
    syncedAt: Date.now(),
    syncedKey: payloadKey(payload),
  });
  await storeForWorker(payload);
  if (previous && previous !== payload.subscription.endpoint) {
    // The browser renewed the subscription. The old endpoint is useless now.
    void callApi("/subscriptions", "DELETE", { endpoint: previous }, deleteResponseSchema).catch(
      () => undefined,
    );
  }
}

/** The browser push service can hang (for example without network). Give up after this. */
const BROWSER_STEP_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number = BROWSER_STEP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new DOMException("The browser push step timed out", "AbortError")),
      ms,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Ask for the permission, subscribe and register the subscription with the Worker. */
export async function enablePush(): Promise<void> {
  if (runtime.busy || readAvailability() !== "available" || !PUSH_API_URL) return;
  setRuntime({ busy: true, error: null, test: { pending: false, message: null } });
  try {
    const permission = await window.Notification.requestPermission();
    // The "Browser notifications" switch shares this permission.
    refreshBrowserPermission();
    if (permission !== "granted") {
      throw new DOMException("Notification permission was not granted", "NotAllowedError");
    }
    await navigator.serviceWorker.register(serviceWorkerUrl(PUSH_API_URL, VAPID_PUBLIC_KEY), {
      scope: "/",
    });
    const registration = await withTimeout(navigator.serviceWorker.ready);
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await withTimeout(
      registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }),
    );
    const payload = currentPayload(subscription);
    if (!payload) throw new PushApiError("Could not read the push subscription. Try again.");
    await postPayload(payload);
    setRuntime({ busy: false, error: null });
  } catch (error) {
    setState({ enabled: false });
    setRuntime({ busy: false, error: pushErrorMessage(error) });
  }
}

/** Unsubscribe in the browser and remove the subscription from the Worker. */
export async function disablePush(): Promise<void> {
  if (runtime.busy) return;
  setRuntime({ busy: true, error: null, test: { pending: false, message: null } });
  const stored = pushStateStore.getSnapshot().endpoint;
  let endpoint = stored;
  try {
    const registration = await existingRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      endpoint = subscription.endpoint;
      await subscription.unsubscribe();
    }
  } catch {
    // The browser keeps an unused subscription. The Worker entry goes below.
  }
  if (endpoint) {
    try {
      await callApi("/subscriptions", "DELETE", { endpoint }, deleteResponseSchema);
    } catch {
      // The Worker removes the entry by itself once its pushes fail.
    }
  }
  setState({ enabled: false, endpoint: null, syncedAt: null, syncedKey: null });
  await storeForWorker(null);
  setRuntime({ busy: false });
}

/** Ask the Worker for one test push. */
export async function sendTestPush(): Promise<void> {
  const endpoint = pushStateStore.getSnapshot().endpoint;
  if (!endpoint || runtime.test.pending) return;
  setRuntime({ test: { pending: true, message: null } });
  try {
    const result = await callApi("/subscriptions/test", "POST", { endpoint }, testResponseSchema);
    setRuntime({
      test: {
        pending: false,
        message: result.sent ? "Test sent." : `Test failed (push service ${result.status}).`,
      },
    });
  } catch (error) {
    setRuntime({
      test: {
        pending: false,
        message: error instanceof PushApiError ? error.message : "Test failed. Try again later.",
      },
    });
  }
}

/**
 * Send the current watchlist to the Worker when push is on and something
 * changed. A missing browser subscription turns push off with a message.
 */
export async function syncPush(): Promise<void> {
  const state = pushStateStore.getSnapshot();
  if (!state.enabled || runtime.busy || readAvailability() !== "available") return;
  try {
    const registration = await existingRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      setState({ enabled: false, endpoint: null, syncedAt: null, syncedKey: null });
      setRuntime({ error: SUBSCRIPTION_EXPIRED_MESSAGE });
      return;
    }
    const payload = currentPayload(subscription);
    if (!payload || payloadKey(payload) === state.syncedKey) return;
    await postPayload(payload);
    if (runtime.error) setRuntime({ error: null });
  } catch (error) {
    setRuntime({ error: pushErrorMessage(error) });
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface PushAlerts {
  status: PushStatus;
  message: string | null;
  /** True when the watchlist has more addresses with alerts on than push covers. */
  capped: boolean;
  testPending: boolean;
  testMessage: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  sendTest: () => Promise<void>;
}

export function pushStatus(
  availability: PushAvailability,
  state: PushState,
  current: Runtime,
): { status: PushStatus; message: string | null } {
  if (availability !== "available") return { status: availability, message: null };
  if (current.busy) return { status: "enabling", message: null };
  if (current.error) return { status: "error", message: current.error };
  return { status: state.enabled ? "on" : "off", message: null };
}

export function usePushAlerts(
  watchlist: readonly string[] = [],
  perAddress: AlertSettings["perAddress"] = {},
): PushAlerts {
  const availability = useSyncExternalStore(noop, readAvailability, serverAvailability);
  const state = useSyncExternalStore(
    pushStateStore.subscribe,
    pushStateStore.getSnapshot,
    pushStateStore.getServerSnapshot,
  );
  const current = useSyncExternalStore(
    subscribeRuntime,
    () => runtime,
    () => INITIAL_RUNTIME,
  );
  const { status, message } = pushStatus(availability, state, current);
  return {
    status,
    message,
    capped: pushAddresses(watchlist, perAddress).length > PUSH_MAX_ADDRESSES,
    testPending: current.test.pending,
    testMessage: current.test.message,
    enable: enablePush,
    disable: disablePush,
    sendTest: sendTestPush,
  };
}
