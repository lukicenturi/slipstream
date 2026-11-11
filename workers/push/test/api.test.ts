import { describe, expect, it, vi } from "vitest";

import { handleRequest, MAX_BODY_BYTES } from "../src/api";
import type { Env } from "../src/env";

import { A } from "./helpers";

vi.mock("../src/db", () => ({
  upsertSubscription: vi.fn(async () => "sub-id"),
  deleteSubscriptionByEndpoint: vi.fn(async () => true),
  findSubscription: vi.fn(async () => null),
  applyTestResult: vi.fn(async () => undefined),
  loadWatchRows: vi.fn(async () => []),
  loadDelivered: vi.fn(async () => new Set()),
  commitTick: vi.fn(async () => undefined),
}));

const env: Env = {
  // The DB module is mocked, so the binding is never used.
  DB: {} as D1Database,
  ALLOWED_ORIGINS: "http://localhost:3100",
  MAX_ADDRESSES_PER_SUBSCRIPTION: "2",
  VAPID_PUBLIC_KEY: "public",
  VAPID_PRIVATE_KEY: "private",
  VAPID_SUBJECT: "mailto:owner@example.com",
  ADMIN_TOKEN: "secret-token",
};

const subscription = {
  endpoint: "https://push.example/send/1",
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4", auth: "tBHItJI5svbpez7K" },
};

function request(path: string, init: RequestInit & { origin?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(`https://worker.example${path}`, { ...init, headers });
}

function post(path: string, body: unknown, origin?: string): Request {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    origin,
  });
}

async function read(response: Response): Promise<unknown> {
  return response.json();
}

describe("handleRequest", () => {
  it("answers /health and /vapid-public-key", async () => {
    const health = await handleRequest(request("/health"), env);
    expect(health.status).toBe(200);
    expect(await read(health)).toMatchObject({ ok: true, network: "any" });
    expect(await read(await handleRequest(request("/vapid-public-key"), env))).toEqual({
      publicKey: "public",
    });
  });

  it("forbids an origin outside the list, with no CORS headers", async () => {
    const response = await handleRequest(
      request("/health", { origin: "https://evil.example" }),
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight from a listed origin", async () => {
    const response = await handleRequest(
      request("/subscriptions", { method: "OPTIONS", origin: "http://localhost:3100" }),
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3100");
  });

  it("returns 404 for an unknown route", async () => {
    expect((await handleRequest(request("/nope"), env)).status).toBe(404);
  });

  it("stores a valid subscription", async () => {
    const response = await handleRequest(
      post(
        "/subscriptions",
        { subscription, network: "mainnet", addresses: [{ address: A }], minNotionalUsd: 0 },
        "http://localhost:3100",
      ),
      env,
    );
    expect(response.status).toBe(200);
    expect(await read(response)).toEqual({ id: "sub-id", addresses: 1 });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3100");
  });

  it("rejects a bad address, too many addresses and a bad network", async () => {
    const bad = await handleRequest(
      post("/subscriptions", {
        subscription,
        network: "mainnet",
        addresses: [{ address: "0x123" }],
        minNotionalUsd: 0,
      }),
      env,
    );
    expect(bad.status).toBe(400);
    expect(await read(bad)).toMatchObject({ error: "invalid_address" });

    const many = await handleRequest(
      post("/subscriptions", {
        subscription,
        network: "mainnet",
        addresses: ["1", "2", "3"].map((digit) => ({ address: `0x${digit.repeat(40)}` })),
        minNotionalUsd: 0,
      }),
      env,
    );
    expect(await read(many)).toMatchObject({ error: "too_many_addresses" });

    const network = await handleRequest(
      post("/subscriptions", { subscription, network: "devnet", addresses: [], minNotionalUsd: 0 }),
      env,
    );
    expect(network.status).toBe(400);
    expect(await read(network)).toMatchObject({ error: "invalid_body" });
  });

  it("rejects bad JSON and a body above 64 KB", async () => {
    const badJson = await handleRequest(
      request("/subscriptions", { method: "POST", body: "{nope" }),
      env,
    );
    expect(await read(badJson)).toMatchObject({ error: "invalid_json" });
    const large = await handleRequest(
      request("/subscriptions", { method: "POST", body: "x".repeat(MAX_BODY_BYTES + 1) }),
      env,
    );
    expect(large.status).toBe(413);
  });

  it("deletes by endpoint and reports an unknown test subscription", async () => {
    const removed = await handleRequest(
      request("/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }),
      env,
    );
    expect(await read(removed)).toEqual({ removed: true });
    const test = await handleRequest(
      post("/subscriptions/test", { endpoint: subscription.endpoint }),
      env,
    );
    expect(test.status).toBe(404);
  });

  it("protects /tick with the admin token", async () => {
    expect((await handleRequest(request("/tick", { method: "POST" }), env)).status).toBe(401);
    const wrong = request("/tick", { method: "POST", headers: { authorization: "Bearer nope" } });
    expect((await handleRequest(wrong, env)).status).toBe(401);
    const right = request("/tick", {
      method: "POST",
      headers: { authorization: "Bearer secret-token" },
    });
    const response = await handleRequest(right, env);
    expect(response.status).toBe(200);
    expect(await read(response)).toMatchObject({ addressesPolled: 0, pushesSent: 0 });
  });
});
