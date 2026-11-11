import { describe, expect, it } from "vitest";

import fixture from "../../../fixtures/userFillsByTime.json";
import { decideOrigin, corsHeaders } from "../src/cors";
import { parseOrigins, readConfig } from "../src/env";
import {
  normalizeWatches,
  parseFills,
  parseSeenTids,
  subscribeBodySchema,
  type SubscribeBody,
} from "../src/schemas";

import { A, B } from "./helpers";

const body: SubscribeBody = {
  subscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: {
      p256dh:
        "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  },
  network: "mainnet",
  addresses: [{ address: A, label: "testooor.hl" }],
  minNotionalUsd: 1000,
};

describe("subscribeBodySchema", () => {
  it("accepts a well-formed body and trims labels", () => {
    const parsed = subscribeBodySchema.parse({
      ...body,
      addresses: [{ address: A, label: "  whale  " }, { address: B, label: "" }, { address: B }],
    });
    expect(parsed.addresses.map((entry) => entry.label)).toEqual(["whale", null, null]);
  });

  it("rejects a bad network, a non-https endpoint, bad keys and a negative threshold", () => {
    expect(subscribeBodySchema.safeParse({ ...body, network: "devnet" }).success).toBe(false);
    expect(
      subscribeBodySchema.safeParse({
        ...body,
        subscription: { ...body.subscription, endpoint: "http://push.example/1" },
      }).success,
    ).toBe(false);
    expect(
      subscribeBodySchema.safeParse({
        ...body,
        subscription: { ...body.subscription, keys: { p256dh: "bad key!", auth: "x" } },
      }).success,
    ).toBe(false);
    expect(subscribeBodySchema.safeParse({ ...body, minNotionalUsd: -1 }).success).toBe(false);
  });
});

describe("normalizeWatches", () => {
  it("lower-cases, drops repeats and keeps the first label", () => {
    const result = normalizeWatches(
      [
        { address: A.toUpperCase().replace("0X", "0x"), label: "first" },
        { address: A, label: "second" },
      ],
      50,
    );
    expect(result).toEqual({ ok: true, watches: [{ address: A, label: "first" }] });
  });

  it("rejects a bad address", () => {
    const result = normalizeWatches([{ address: "0x123", label: null }], 50);
    expect(result).toMatchObject({ ok: false, error: "invalid_address" });
  });

  it("rejects more addresses than the limit, after repeats are dropped", () => {
    const many = Array.from({ length: 3 }, (_, index) => ({
      address: `0x${String(index).padStart(40, "0")}`,
      label: null,
    }));
    expect(normalizeWatches(many, 2)).toMatchObject({ ok: false, error: "too_many_addresses" });
    expect(normalizeWatches([...many, ...many], 3)).toMatchObject({ ok: true });
  });

  it("keeps an empty list", () => {
    expect(normalizeWatches([], 50)).toEqual({ ok: true, watches: [] });
  });
});

describe("parseFills", () => {
  it("parses the saved userFillsByTime response", () => {
    const fills = parseFills(fixture);
    expect(fills).toHaveLength(fixture.length);
    expect(fills?.[0]).toMatchObject({ coin: "SOL", side: "buy", dir: "Close Short" });
    expect(typeof fills?.[0]?.px).toBe("number");
  });

  it("drops bad entries and rejects a body that is not an array", () => {
    expect(parseFills([{ coin: "BTC" }, ...fixture.slice(0, 1)])).toHaveLength(1);
    expect(parseFills({ error: "x" })).toBeNull();
  });

  it("reads the stored seen tids", () => {
    expect(parseSeenTids("[1,2]")).toEqual([1, 2]);
    expect(parseSeenTids("nope")).toEqual([]);
    expect(parseSeenTids(null)).toEqual([]);
  });
});

describe("origins", () => {
  const allowed = parseOrigins("https://slipstream-hl.vercel.app, http://localhost:3100/ ,");

  it("parses the list", () => {
    expect(allowed).toEqual(["https://slipstream-hl.vercel.app", "http://localhost:3100"]);
  });

  it("allows listed origins, forbids others, and lets requests without Origin through", () => {
    expect(decideOrigin("http://localhost:3100", allowed)).toEqual({
      kind: "allowed",
      origin: "http://localhost:3100",
    });
    expect(decideOrigin("https://evil.example", allowed)).toEqual({ kind: "forbidden" });
    expect(decideOrigin(null, allowed)).toEqual({ kind: "none" });
    expect(corsHeaders({ kind: "none" })).toEqual({});
    expect(corsHeaders({ kind: "allowed", origin: "http://localhost:3100" })).toMatchObject({
      "access-control-allow-origin": "http://localhost:3100",
    });
  });

  it("reads the config with defaults for bad values", () => {
    const config = readConfig({
      DB: {} as D1Database,
      MAX_ADDRESSES_PER_SUBSCRIPTION: "nope",
      MAX_SUBREQUESTS_PER_TICK: "900",
    });
    expect(config).toEqual({
      allowedOrigins: [],
      maxAddressesPerSubscription: 50,
      maxAddressesPerTick: 300,
      maxSubrequestsPerTick: 900,
    });
  });
});
