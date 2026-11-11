import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  userFillsMessageSchema,
  type Fill,
  type UserFillsMessage,
} from "@/lib/hyperliquid/schemas";

import {
  feedIntegrity,
  initialLiveFeedState,
  liveFeedReducer,
  MAX_FEED_ITEMS,
  MAX_SEEN_TIDS,
  SNAPSHOT_ITEMS_PER_TRADER,
  seenKey,
  type LiveFeedState,
} from "./liveFeed";
import { makeFill } from "./testFills";

const USER_A = "0x00000000000000000000000000000000000000aa";
const USER_B = "0x00000000000000000000000000000000000000bb";

function message(user: string, fills: Fill[], isSnapshot: boolean): UserFillsMessage {
  return { channel: "userFills", isSnapshot, user, fills };
}

function apply(state: LiveFeedState, ...messages: UserFillsMessage[]): LiveFeedState {
  return messages.reduce(
    (current, m) => liveFeedReducer(current, { type: "message", message: m }),
    state,
  );
}

function expectNoDuplicates(state: LiveFeedState): void {
  const integrity = feedIntegrity(state.items);
  expect(integrity.uniqueOrders).toBe(integrity.items);
  expect(integrity.uniqueTids).toBe(integrity.tids);
}

/** Fills of `orders` orders, two partial fills each, one second apart. */
function history(orders: number, startOid = 1, startTime = 1_000_000): Fill[] {
  return Array.from({ length: orders }, (_, index) => [
    makeFill({
      oid: startOid + index,
      tid: (startOid + index) * 10,
      time: startTime + index * 1000,
    }),
    makeFill({
      oid: startOid + index,
      tid: (startOid + index) * 10 + 1,
      time: startTime + index * 1000 + 5,
    }),
  ]).flat();
}

describe("liveFeedReducer", () => {
  it("does not duplicate items when the same snapshot arrives twice", () => {
    const snapshot = message(USER_A, history(5), true);
    const once = apply(initialLiveFeedState, snapshot);
    const twice = apply(once, snapshot);
    expect(once.items).toHaveLength(5);
    expect(twice.items).toEqual(once.items);
    expect(twice.stats.snapshots).toBe(2);
    expect(twice.stats.duplicatesDropped).toBe(10);
    expectNoDuplicates(twice);
  });

  it("does not duplicate the real fixture snapshot after a reconnect", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures", "ws-userFills.json"), "utf8"),
    );
    const [snapshot, live] = (raw as unknown[]).map((entry) => userFillsMessageSchema.parse(entry));
    // Snapshot, live fills, then the snapshot replay after a reconnect.
    const state = apply(initialLiveFeedState, snapshot, live, snapshot, live);
    const expected = feedIntegrity(apply(initialLiveFeedState, snapshot, live).items);
    expect(feedIntegrity(state.items)).toEqual(expected);
    expectNoDuplicates(state);
  });

  it("seeds snapshot items as not live and keeps the 20 newest orders per trader", () => {
    const state = apply(initialLiveFeedState, message(USER_A, history(30), true));
    expect(state.items).toHaveLength(SNAPSHOT_ITEMS_PER_TRADER);
    expect(state.items.every((item) => !item.live)).toBe(true);
    // The newest order (oid 30) comes first, and the oldest kept is oid 11.
    expect(state.items[0].oid).toBe(30);
    expect(state.items.at(-1)?.oid).toBe(11);
    expect(state.items[0].fillCount).toBe(2);
  });

  it("flags live fills as live and puts them first", () => {
    const seeded = apply(initialLiveFeedState, message(USER_A, history(3), true));
    const state = apply(
      seeded,
      message(USER_A, [makeFill({ oid: 99, tid: 999, time: 2_000_000 })], false),
    );
    expect(state.items[0]).toMatchObject({ oid: 99, live: true });
    expect(state.items).toHaveLength(4);
  });

  it("drops a live fill that the feed already has", () => {
    const fills = history(2);
    const seeded = apply(initialLiveFeedState, message(USER_A, fills, true));
    const state = apply(seeded, message(USER_A, [fills[0]], false));
    expect(state.items).toEqual(seeded.items);
    expectNoDuplicates(state);
  });

  it("merges a live partial fill into the snapshot item of the same order", () => {
    const seeded = apply(initialLiveFeedState, message(USER_A, history(1), true));
    const state = apply(
      seeded,
      message(USER_A, [makeFill({ oid: 1, tid: 500, time: 1_000_100 })], false),
    );
    expect(state.items).toHaveLength(1);
    expect(state.items[0].fillCount).toBe(3);
  });

  it("adds fills from the outage when the snapshot replays after a reconnect", () => {
    const first = history(3);
    const seeded = apply(initialLiveFeedState, message(USER_A, first, true));
    const outage = history(2, 50, 1_100_000);
    const state = apply(seeded, message(USER_A, [...outage, ...first], true));
    expect(state.items).toHaveLength(5);
    expectNoDuplicates(state);
  });

  it("ignores old history in a replay even when its tids left the seen set", () => {
    const seeded = apply(initialLiveFeedState, message(USER_A, history(2, 1, 2_000_000), true));
    const forgotten: LiveFeedState = { ...seeded, seenTids: new Set() };
    const state = apply(forgotten, message(USER_A, history(2, 1, 2_000_000), true));
    // The newest fill sits on the watermark, so only its tid can come back; it is
    // still the same order, so the order merges and no new item appears.
    expect(state.items).toHaveLength(2);
    expect(feedIntegrity(state.items).uniqueOrders).toBe(2);
  });

  it("keeps both sides of one trade when two traders share a tid", () => {
    const state = apply(
      initialLiveFeedState,
      message(USER_A, history(2), true),
      message(USER_B, history(2), true),
    );
    expect(state.items).toHaveLength(4);
    expectNoDuplicates(state);
  });

  it("caps the feed at 100 items", () => {
    let state = initialLiveFeedState;
    for (let index = 0; index < 120; index += 1) {
      state = apply(
        state,
        message(USER_A, [makeFill({ oid: index, tid: index, time: index })], false),
      );
    }
    expect(state.items).toHaveLength(MAX_FEED_ITEMS);
    expect(state.items[0].oid).toBe(119);
  });

  it("caps the seen tid set and drops the oldest tids first", () => {
    const fills = Array.from({ length: MAX_SEEN_TIDS + 10 }, (_, index) =>
      makeFill({ oid: index, tid: index, time: index }),
    );
    const state = apply(initialLiveFeedState, message(USER_A, fills, false));
    expect(state.seenTids.size).toBe(MAX_SEEN_TIDS);
    expect(state.seenTids.has(seenKey(USER_A, 0))).toBe(false);
    expect(state.seenTids.has(seenKey(USER_A, MAX_SEEN_TIDS + 9))).toBe(true);
  });

  it("does not change the previous state", () => {
    const seeded = apply(initialLiveFeedState, message(USER_A, history(1), true));
    const before = seeded.seenTids.size;
    apply(seeded, message(USER_A, [makeFill({ oid: 7, tid: 70, time: 3_000_000 })], false));
    expect(seeded.seenTids.size).toBe(before);
    expect(initialLiveFeedState.items).toHaveLength(0);
  });
});
