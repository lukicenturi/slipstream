import { describe, expect, it } from "vitest";

import {
  aggregateFills,
  mergeFillIntoItems,
  toFeedItem,
  MERGE_WINDOW_MS,
  type FeedItem,
} from "./aggregateFills";
import { makeFill } from "./testFills";

const USER = "0xF5d81a135f756ca16544e53c20fc20643ec3ad53";

describe("aggregateFills", () => {
  it("returns an empty list for no fills", () => {
    expect(aggregateFills([])).toEqual([]);
  });

  it("joins two partial fills of one order with a size-weighted average price", () => {
    const [item, ...rest] = aggregateFills([
      makeFill({ oid: 7, tid: 1, px: 100, sz: 1, time: 10, closedPnl: 2, fee: 0.1 }),
      makeFill({ oid: 7, tid: 2, px: 110, sz: 3, time: 20, closedPnl: 3, fee: 0.2 }),
    ]);
    expect(rest).toHaveLength(0);
    expect(item.sz).toBe(4);
    expect(item.px).toBeCloseTo(107.5);
    expect(item.notional).toBeCloseTo(430);
    expect(item.closedPnl).toBe(5);
    expect(item.fee).toBeCloseTo(0.3);
    expect(item.time).toBe(20);
    expect(item.firstTime).toBe(10);
    expect(item.fillCount).toBe(2);
    expect(item.tids).toEqual([1, 2]);
  });

  it("keeps different orders apart", () => {
    const items = aggregateFills([
      makeFill({ oid: 1, tid: 1, time: 10 }),
      makeFill({ oid: 2, tid: 2, time: 11 }),
    ]);
    expect(items.map((item) => item.oid)).toEqual([2, 1]);
  });

  it("orders items newest first by the latest fill", () => {
    const items = aggregateFills([
      makeFill({ oid: 1, tid: 1, time: 10 }),
      makeFill({ oid: 2, tid: 2, time: 20 }),
      makeFill({ oid: 1, tid: 3, time: 30 }),
      makeFill({ oid: 3, tid: 4, time: 25 }),
    ]);
    expect(items.map((item) => [item.oid, item.time])).toEqual([
      [1, 30],
      [3, 25],
      [2, 20],
    ]);
  });

  it("names a split flip order as a flip", () => {
    const [item] = aggregateFills([
      makeFill({ oid: 1, tid: 1, time: 10, dir: "Close Long", side: "sell" }),
      makeFill({ oid: 1, tid: 2, time: 11, dir: "Open Short", side: "sell" }),
    ]);
    expect(item.dir).toBe("Long > Short");
  });
});

describe("mergeFillIntoItems", () => {
  const base = (): FeedItem[] => [
    toFeedItem(
      aggregateFills([makeFill({ oid: 9, tid: 1, px: 100, sz: 1, time: 0 })])[0],
      USER,
      false,
    ),
  ];

  it("merges a late partial fill of the same order within 60 s", () => {
    const items = mergeFillIntoItems(
      base(),
      makeFill({ oid: 9, tid: 2, px: 200, sz: 1, time: 59_000 }),
      {
        user: USER,
        live: true,
      },
    );
    expect(items).toHaveLength(1);
    expect(items[0].sz).toBe(2);
    expect(items[0].px).toBeCloseTo(150);
    expect(items[0].time).toBe(59_000);
    // The merged item keeps its id and its live flag.
    expect(items[0].id).toBe(base()[0].id);
    expect(items[0].live).toBe(false);
  });

  it("starts a new item for a partial fill more than 60 s later", () => {
    const items = mergeFillIntoItems(
      base(),
      makeFill({ oid: 9, tid: 2, time: MERGE_WINDOW_MS + 1 }),
      { user: USER, live: true },
    );
    expect(items).toHaveLength(2);
    expect(items[0].live).toBe(true);
    expect(items[0].id).not.toBe(items[1].id);
  });

  it("does not merge the same oid of another trader", () => {
    const items = mergeFillIntoItems(base(), makeFill({ oid: 9, tid: 2, time: 1 }), {
      user: "0x0000000000000000000000000000000000000001",
      live: true,
    });
    expect(items).toHaveLength(2);
  });

  it("keeps the list ordered newest first", () => {
    let items = base();
    items = mergeFillIntoItems(items, makeFill({ oid: 1, tid: 5, time: 500 }), {
      user: USER,
      live: true,
    });
    items = mergeFillIntoItems(items, makeFill({ oid: 2, tid: 6, time: 300 }), {
      user: USER,
      live: true,
    });
    expect(items.map((item) => item.time)).toEqual([500, 300, 0]);
  });
});
