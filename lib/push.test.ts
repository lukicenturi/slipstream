import { describe, expect, it } from "vitest";

import { pickDisplayName } from "@/lib/names";

import {
  buildSubscriptionPayload,
  DEFAULT_PUSH_STATE,
  isIosDevice,
  parsePushApiUrl,
  parsePushState,
  payloadKey,
  PUSH_MAX_ADDRESSES,
  pushAddresses,
  pushAvailability,
  pushErrorMessage,
  sameKey,
  serviceWorkerUrl,
  subscribeResponseSchema,
  testResponseSchema,
  urlBase64ToUint8Array,
} from "./push";

const A = "0x5b5d51203a0f9079f8aeb098a6523a13f298c060";
const B = "0xf5d81a135f756ca16544e53c20fc20643ec3ad53";
const C = "0xf26f5551e96ae5162509b25925fffa7f07b2d652";

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "BNcRdreALRFXTkOO", auth: "tBHItJI5svbpez7K" },
};

function labels(address: string) {
  return pickDisplayName({ hlName: address === C ? "testooor.hl" : null, address });
}

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url without padding", () => {
    expect([...urlBase64ToUint8Array("AQID")]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
    expect([...urlBase64ToUint8Array("AQ")]).toEqual([1]);
  });

  it("compares key bytes", () => {
    const key = urlBase64ToUint8Array("AQID");
    expect(sameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2]), key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});

describe("parsePushApiUrl", () => {
  it("keeps the origin of an http(s) URL", () => {
    expect(parsePushApiUrl("https://push.example.workers.dev/")).toBe(
      "https://push.example.workers.dev",
    );
    expect(parsePushApiUrl(" http://localhost:8787 ")).toBe("http://localhost:8787");
  });

  it("returns null for an empty or bad value", () => {
    expect(parsePushApiUrl(undefined)).toBeNull();
    expect(parsePushApiUrl("")).toBeNull();
    expect(parsePushApiUrl("ftp://x.example")).toBeNull();
    expect(parsePushApiUrl("not a url")).toBeNull();
  });

  it("builds the service worker URL with both values", () => {
    expect(serviceWorkerUrl("https://w.example", "AB_c")).toBe(
      "/sw.js?api=https%3A%2F%2Fw.example&vapid=AB_c",
    );
  });
});

describe("buildSubscriptionPayload", () => {
  it("applies the per-address switches, lower-cases and adds names only", () => {
    const payload = buildSubscriptionPayload({
      subscription: { ...subscription, keys: { ...subscription.keys } },
      network: "testnet",
      watchlist: [A.toUpperCase().replace("0X", "0x"), B, C, A],
      perAddress: { [B]: { enabled: false } },
      labels,
      minNotionalUsd: 10_000,
    });
    expect(payload).toEqual({
      subscription,
      network: "testnet",
      addresses: [{ address: A }, { address: C, label: "testooor.hl" }],
      minNotionalUsd: 10_000,
    });
  });

  it("sends at most 50 addresses", () => {
    const many = Array.from({ length: 60 }, (_, index) => `0x${String(index).padStart(40, "0")}`);
    expect(pushAddresses(many, {})).toHaveLength(60);
    const payload = buildSubscriptionPayload({
      subscription,
      network: "mainnet",
      watchlist: many,
      perAddress: {},
      labels,
      minNotionalUsd: 0,
    });
    expect(payload.addresses).toHaveLength(PUSH_MAX_ADDRESSES);
  });

  it("keeps an empty watchlist", () => {
    const payload = buildSubscriptionPayload({
      subscription,
      network: "mainnet",
      watchlist: [],
      perAddress: {},
      labels,
      minNotionalUsd: 0,
    });
    expect(payload.addresses).toEqual([]);
  });
});

describe("payloadKey", () => {
  const base = buildSubscriptionPayload({
    subscription,
    network: "mainnet",
    watchlist: [A, C],
    perAddress: {},
    labels,
    minNotionalUsd: 0,
  });

  it("ignores the order of the addresses", () => {
    expect(payloadKey({ ...base, addresses: [...base.addresses].reverse() })).toBe(
      payloadKey(base),
    );
  });

  it("changes with the threshold, a label, the addresses or the endpoint", () => {
    const key = payloadKey(base);
    expect(payloadKey({ ...base, minNotionalUsd: 1_000 })).not.toBe(key);
    expect(payloadKey({ ...base, addresses: [{ address: A }, { address: C }] })).not.toBe(key);
    expect(payloadKey({ ...base, addresses: [{ address: A }] })).not.toBe(key);
    expect(
      payloadKey({ ...base, subscription: { ...subscription, endpoint: "https://x.example/2" } }),
    ).not.toBe(key);
  });
});

describe("pushAvailability", () => {
  const ready = {
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    isIos: false,
    isStandalone: false,
    configured: true,
  };

  it("is available with every API and the configuration", () => {
    expect(pushAvailability(ready)).toBe("available");
  });

  it("is not configured without the variables, before any browser check", () => {
    expect(pushAvailability({ ...ready, configured: false, hasPushManager: false })).toBe(
      "not-configured",
    );
  });

  it("asks iPhone Safari to install the app first", () => {
    expect(pushAvailability({ ...ready, isIos: true, hasPushManager: false })).toBe(
      "needs-install",
    );
    expect(pushAvailability({ ...ready, isIos: true, isStandalone: true })).toBe("available");
  });

  it("is unsupported without a service worker, PushManager or Notification", () => {
    expect(pushAvailability({ ...ready, hasServiceWorker: false })).toBe("unsupported");
    expect(pushAvailability({ ...ready, hasPushManager: false })).toBe("unsupported");
    expect(pushAvailability({ ...ready, hasNotification: false })).toBe("unsupported");
  });

  it("detects iPhone and iPad", () => {
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(isIosDevice(iphone, "iPhone", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 0)).toBe(false);
  });
});

describe("parsePushState", () => {
  it("returns the defaults for a missing value or bad JSON", () => {
    expect(parsePushState(null)).toEqual(DEFAULT_PUSH_STATE);
    expect(parsePushState("{nope")).toEqual(DEFAULT_PUSH_STATE);
    expect(parsePushState("[]")).toEqual(DEFAULT_PUSH_STATE);
  });

  it("keeps good fields and drops bad ones one by one", () => {
    expect(
      parsePushState(JSON.stringify({ enabled: true, endpoint: 5, syncedAt: 10, syncedKey: "k" })),
    ).toEqual({ enabled: true, endpoint: null, syncedAt: 10, syncedKey: "k" });
    expect(parsePushState(JSON.stringify({ enabled: true, endpoint: "e", syncedAt: 1 }))).toEqual({
      enabled: true,
      endpoint: "e",
      syncedAt: 1,
      syncedKey: null,
    });
  });
});

describe("responses and messages", () => {
  it("parses the API responses", () => {
    expect(subscribeResponseSchema.parse({ id: "x", addresses: 2 })).toEqual({
      id: "x",
      addresses: 2,
    });
    expect(testResponseSchema.safeParse({ sent: "yes" }).success).toBe(false);
  });

  it("maps browser errors to short messages", () => {
    expect(pushErrorMessage(new DOMException("denied", "NotAllowedError"))).toMatch(/blocked/);
    expect(pushErrorMessage(new DOMException("no service", "AbortError"))).toMatch(/push service/);
    expect(pushErrorMessage(new TypeError("Failed to fetch"))).toMatch(/push server/);
    const api = new Error("At most 50 addresses per subscription");
    api.name = "PushApiError";
    expect(pushErrorMessage(api)).toBe("At most 50 addresses per subscription");
    expect(pushErrorMessage("x")).toMatch(/Could not turn on/);
  });
});
