import { beforeEach, describe, expect, it, vi } from "vitest";

import * as db from "../src/db";
import type { Env } from "../src/env";
import type { WatchRow } from "../src/schemas";
import { runTick } from "../src/watch";
import { NEW_CURSOR_LOOKBACK_MS } from "../src/watcher";

import { A, row } from "./helpers";

vi.mock("../src/db", () => ({
  loadWatchRows: vi.fn(),
  loadDelivered: vi.fn(async () => new Set<string>()),
  commitTick: vi.fn(async () => undefined),
}));

vi.mock("../src/push", () => ({ sendPush: vi.fn() }));

import { sendPush } from "../src/push";

const NOW = 10_000_000;

const env: Env = {
  // The DB module is mocked, so the binding is never used.
  DB: {} as D1Database,
  VAPID_PUBLIC_KEY: "public",
  VAPID_PRIVATE_KEY: "private",
  VAPID_SUBJECT: "mailto:owner@example.com",
};

function apiFill(time: number, tid: number, oid = tid) {
  return {
    coin: "BTC",
    px: "100",
    sz: "2",
    side: "B",
    time,
    dir: "Open Long",
    closedPnl: "0",
    oid,
    tid,
    hash: "0x0",
  };
}

function infoFetch(fills: unknown[]) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    void init;
    if (input.includes("hyperliquid")) return Response.json(fills);
    return new Response(null, { status: 500 });
  });
}

function lastWrites(): db.TickWrites {
  const calls = vi.mocked(db.commitTick).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error("commitTick was not called");
  return call[1];
}

function setRows(rows: WatchRow[]) {
  vi.mocked(db.loadWatchRows).mockResolvedValue(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTick", () => {
  it("starts a new cursor two minutes back and pushes only fills after it", async () => {
    setRows([row()]);
    vi.mocked(sendPush).mockResolvedValue(201);
    const fetchFn = infoFetch([apiFill(NOW - NEW_CURSOR_LOOKBACK_MS + 1, 1)]);
    const stats = await runTick(env, { fetch: fetchFn, now: () => NOW });

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ type: "userFillsByTime", user: A, startTime: NOW - 120_000 });
    expect(stats).toMatchObject({ addressesPolled: 1, fillsSeen: 1, itemsBuilt: 1, pushesSent: 1 });
    const writes = lastWrites();
    expect(writes.deliveries).toEqual([{ subscriptionId: "sub-1", itemId: `mainnet:${A}:1` }]);
    expect(writes.cursors[0]?.cursor).toEqual({ lastTime: NOW - 119_999, seenTids: [1] });
  });

  it("counts failures and removes a gone subscription", async () => {
    setRows([row(), row({ id: "sub-2", endpoint: "https://push.example/2", failures: 9 })]);
    vi.mocked(sendPush).mockImplementation(async (subscription) =>
      subscription.id === "sub-1" ? 410 : 500,
    );
    const stats = await runTick(env, { fetch: infoFetch([apiFill(NOW, 1)]), now: () => NOW });
    expect(stats).toMatchObject({ pushesFailed: 2, subscriptionsRemoved: 2 });
    expect(lastWrites().removals.sort()).toEqual(["sub-1", "sub-2"]);
    expect(lastWrites().deliveries).toEqual([]);
  });

  it("keeps the cursor of an address whose push did not fit the budget", async () => {
    setRows([row({ last_time: NOW - 5_000, seen_tids: "[]", polled_at: 1 })]);
    const stats = await runTick(
      { ...env, MAX_SUBREQUESTS_PER_TICK: "1" },
      { fetch: infoFetch([apiFill(NOW, 1)]), now: () => NOW },
    );
    expect(stats).toMatchObject({ addressesPolled: 1, pushesDeferred: 1, pushesSent: 0 });
    expect(sendPush).not.toHaveBeenCalled();
    const writes = lastWrites();
    expect(writes.cursors).toEqual([]);
    expect(writes.polled).toEqual([{ network: "mainnet", address: A, polledAt: NOW }]);
  });

  it("skips delivered items and keeps polling when the info call fails", async () => {
    setRows([row({ last_time: NOW - 5_000, seen_tids: "[]", polled_at: 1 })]);
    vi.mocked(db.loadDelivered).mockResolvedValueOnce(new Set([`sub-1|mainnet:${A}:1`]));
    const ok = await runTick(env, { fetch: infoFetch([apiFill(NOW, 1)]), now: () => NOW });
    expect(ok).toMatchObject({ itemsBuilt: 1, pushesPlanned: 0 });

    const failing = vi.fn(async () => new Response("busy", { status: 429 }));
    const stats = await runTick(env, { fetch: failing, now: () => NOW });
    expect(stats).toMatchObject({ addressesPolled: 1, pollErrors: 1 });
    expect(lastWrites().polled).toHaveLength(1);
  });
});
