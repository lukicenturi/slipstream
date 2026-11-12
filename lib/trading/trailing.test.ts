import { describe, expect, it } from "vitest";

import type { OpenOrder } from "@/lib/hyperliquid/schemas";

import {
  bestMid,
  clampTrailPct,
  initialStop,
  isFavourableMove,
  isFavourableOnChain,
  nextTrailingStop,
  parseTrailingConfigs,
  planModifyCleanup,
  planTrailingCancel,
  reconcileTrailing,
  removeTrailing,
  TRAIL_MIN_INTERVAL_MS,
  trailingLabelOids,
  trailingLockName,
  trailingRoleOf,
  trailingStopOids,
  trailingStorageKey,
  upsertTrailing,
  type TrailingConfig,
} from "./trailing";

const T0 = 1_794_400_000_000;

const LONG: TrailingConfig = {
  coin: "BTC",
  positionSide: "long",
  trailPct: 0.02,
  assetIndex: 3,
  szDecimals: 5,
  size: 0.01,
  oid: 424242,
  stopPx: 68_600,
  highWater: 70_000,
  createdAt: T0,
  updatedAt: T0,
  lastModifyAt: T0,
};

const SHORT: TrailingConfig = {
  ...LONG,
  coin: "ETH",
  positionSide: "short",
  szDecimals: 4,
  stopPx: 2040,
  highWater: 2000,
};

const LATER = T0 + TRAIL_MIN_INTERVAL_MS;

describe("trailingStorageKey", () => {
  it("is scoped to the network and the lower-case owner", () => {
    expect(trailingStorageKey("mainnet", "0xABCdef")).toBe("slipstream.trailing.mainnet.0xabcdef");
  });
});

describe("trailingLockName", () => {
  it("is the storage key plus the coin", () => {
    expect(trailingLockName("testnet", "0xABC", "BTC")).toBe(
      "slipstream.trailing.testnet.0xabc.BTC",
    );
  });
});

describe("initialStop", () => {
  it("puts the stop under the mid for a long and above it for a short, rounded down", () => {
    expect(initialStop("long", 70_000, 0.02, 5)).toBe("68600");
    expect(initialStop("short", 2000, 0.02, 4)).toBe("2040");
    expect(initialStop("long", 1987.65, 0.01, 4)).toBe("1967.7");
  });

  it("throws without a mid", () => {
    expect(() => initialStop("long", 0, 0.02, 5)).toThrow();
  });
});

describe("nextTrailingStop (long)", () => {
  it("moves the stop up when the mid rises", () => {
    // 72,100 x 0.98 = 70,658
    expect(nextTrailingStop(LONG, 72_100, LATER)).toEqual({ stopPx: 70_658, highWater: 72_100 });
  });

  it("does nothing when the mid falls", () => {
    expect(nextTrailingStop(LONG, 66_500, LATER)).toBeNull();
  });

  it("uses the high water mark, not a lower mid", () => {
    const config = { ...LONG, highWater: 75_000, stopPx: 73_500 };
    expect(nextTrailingStop(config, 74_000, LATER)).toBeNull();
  });

  it("waits 15 s after the last update", () => {
    expect(nextTrailingStop(LONG, 72_100, LATER - 1)).toBeNull();
    expect(nextTrailingStop(LONG, 72_100, LATER)).not.toBeNull();
  });

  it("skips a step under 0.1 % of the stop", () => {
    // 70,060 x 0.98 = 68,658.8 -> 68,658: +58 is under 68.6 (0.1 %).
    expect(nextTrailingStop(LONG, 70_060, LATER)).toBeNull();
    // 70,075 x 0.98 = 68,673.5 -> 68,673: +73 passes.
    expect(nextTrailingStop(LONG, 70_075, LATER)).toEqual({ stopPx: 68_673, highWater: 70_075 });
  });

  it("ignores a bad mid", () => {
    expect(nextTrailingStop(LONG, Number.NaN, LATER)).toBeNull();
    expect(nextTrailingStop(LONG, 0, LATER)).toBeNull();
  });

  it("sends nothing after a spike and a fall, when the candidate is above the mid", () => {
    // A spike to 75,000 then a fall to 72,000: 75,000 x 0.98 = 73,500 is above the mid.
    const config = { ...LONG, highWater: 75_000, stopPx: 68_600, trailPct: 0.02 };
    expect(nextTrailingStop(config, 72_000, LATER)).toBeNull();
    // Inside 0.1 % of the mid is refused too (73,500 vs 73,550).
    expect(nextTrailingStop(config, 73_550, LATER)).toBeNull();
    // The caller keeps the high water mark, so the move goes out once the mid is back above it.
    expect(nextTrailingStop(config, 74_000, LATER)).toEqual({ stopPx: 73_500, highWater: 75_000 });
  });
});

describe("nextTrailingStop (short)", () => {
  it("moves the stop down when the mid falls", () => {
    // 1,900 x 1.02 = 1,938
    expect(nextTrailingStop(SHORT, 1900, LATER)).toEqual({ stopPx: 1938, highWater: 1900 });
  });

  it("does nothing when the mid rises", () => {
    expect(nextTrailingStop(SHORT, 2100, LATER)).toBeNull();
  });

  it("sends nothing after a fall and a rise, when the candidate is under the mid", () => {
    // Low 1,800 x 1.02 = 1,836, but the mid is back at 1,900.
    const config = { ...SHORT, highWater: 1800 };
    expect(nextTrailingStop(config, 1900, LATER)).toBeNull();
    expect(nextTrailingStop(config, 1820, LATER)).toEqual({ stopPx: 1836, highWater: 1800 });
  });
});

describe("never worse", () => {
  it("never returns a stop that is worse for the position, over a random walk", () => {
    for (const base of [LONG, SHORT]) {
      let config = { ...base };
      let now = T0;
      let mid = base.highWater;
      let seed = 7;
      for (let step = 0; step < 2000; step += 1) {
        seed = (seed * 16807) % 2147483647;
        mid *= 1 + (seed / 2147483647 - 0.5) * 0.02;
        now += 5_000;
        const next = nextTrailingStop(config, mid, now);
        if (!next) continue;
        expect(isFavourableMove(config.positionSide, config.stopPx, next.stopPx)).toBe(true);
        config = { ...config, stopPx: next.stopPx, highWater: next.highWater, lastModifyAt: now };
      }
    }
  });

  it("isFavourableMove and bestMid follow the side", () => {
    expect(isFavourableMove("long", 100, 101)).toBe(true);
    expect(isFavourableMove("long", 100, 99)).toBe(false);
    expect(isFavourableMove("short", 100, 99)).toBe(true);
    expect(isFavourableMove("short", 100, 100)).toBe(false);
    expect(isFavourableMove("long", Number.NaN, 1)).toBe(false);
    expect(bestMid("long", 100, 105)).toBe(105);
    expect(bestMid("short", 100, 105)).toBe(100);
    expect(bestMid("short", 100, Number.NaN)).toBe(100);
  });
});

describe("clampTrailPct", () => {
  it("clamps to 0.5 to 50 %", () => {
    expect(clampTrailPct(0.1)).toBe(0.5);
    expect(clampTrailPct(2)).toBe(2);
    expect(clampTrailPct(80)).toBe(50);
    expect(clampTrailPct(Number.NaN)).toBeNull();
  });
});

describe("storage", () => {
  it("parses a stored list and drops a bad entry", () => {
    const raw = JSON.stringify([LONG, { ...SHORT, trailPct: 0.9 }, { coin: "SOL" }, SHORT]);
    expect(parseTrailingConfigs(raw)).toEqual([LONG, SHORT]);
  });

  it("gives [] for null, bad JSON and a non-array", () => {
    expect(parseTrailingConfigs(null)).toEqual([]);
    expect(parseTrailingConfigs("{")).toEqual([]);
    expect(parseTrailingConfigs('{"coin":"BTC"}')).toEqual([]);
  });

  it("keeps one entry per coin", () => {
    const raw = JSON.stringify([LONG, { ...LONG, stopPx: 69_000 }]);
    expect(parseTrailingConfigs(raw)).toEqual([{ ...LONG, stopPx: 69_000 }]);
  });

  it("adds, replaces and removes by coin", () => {
    const list = upsertTrailing([LONG], SHORT);
    expect(list.map((entry) => entry.coin)).toEqual(["BTC", "ETH"]);
    expect(
      upsertTrailing(list, { ...LONG, stopPx: 69_000 }).find((e) => e.coin === "BTC")?.stopPx,
    ).toBe(69_000);
    expect(removeTrailing(list, "BTC")).toEqual([SHORT]);
  });
});

function order(partial: Partial<OpenOrder>): OpenOrder {
  return {
    coin: "BTC",
    side: "sell",
    limitPx: 61_740,
    sz: 0,
    origSz: 0,
    oid: 1,
    timestamp: T0,
    isTrigger: true,
    triggerPx: 68_600,
    triggerCondition: "Price below 68600",
    isPositionTpsl: true,
    reduceOnly: true,
    orderType: "Stop Market",
    tif: null,
    cloid: null,
    ...partial,
  };
}

describe("reconcileTrailing", () => {
  it("waits for a snapshot newer than the last change", () => {
    expect(reconcileTrailing(LONG, [], T0 + 1000)).toEqual({ kind: "wait" });
  });

  it("keeps a config whose oid is open", () => {
    expect(reconcileTrailing(LONG, [order({ oid: 424242 })], T0 + 10_000)).toEqual({
      kind: "keep",
    });
  });

  it("adopts a better on-chain trigger price on keep, and ignores a worse one", () => {
    expect(
      reconcileTrailing(LONG, [order({ oid: 424242, triggerPx: 70_000 })], T0 + 10_000),
    ).toEqual({ kind: "keep", stopPx: 70_000 });
    expect(
      reconcileTrailing(LONG, [order({ oid: 424242, triggerPx: 68_000 })], T0 + 10_000),
    ).toEqual({ kind: "keep" });
    // A short: lower is better.
    expect(
      reconcileTrailing(
        SHORT,
        [order({ coin: "ETH", side: "buy", oid: 424242, triggerPx: 2030 })],
        T0 + 10_000,
      ),
    ).toEqual({ kind: "keep", stopPx: 2030 });
  });

  it("adopts a new oid for the same stop", () => {
    expect(reconcileTrailing(LONG, [order({ oid: 99 })], T0 + 10_000)).toEqual({
      kind: "adopt",
      oid: 99,
    });
  });

  it("adopts only a stop-market trigger that is not older than the config", () => {
    // A stop limit at the same price is not the trailing stop.
    expect(
      reconcileTrailing(LONG, [order({ oid: 99, orderType: "Stop Limit" })], T0 + 10_000),
    ).toEqual({ kind: "gone" });
    // A stop placed by hand before the trailing stop started is not adopted.
    expect(reconcileTrailing(LONG, [order({ oid: 99, timestamp: T0 - 1 })], T0 + 10_000)).toEqual({
      kind: "gone",
    });
    expect(
      reconcileTrailing(LONG, [order({ oid: 99, timestamp: T0 + 20_000 })], T0 + 30_000),
    ).toEqual({ kind: "adopt", oid: 99 });
  });

  it("says gone when no matching stop is open", () => {
    expect(reconcileTrailing(LONG, [order({ oid: 99, triggerPx: 60_000 })], T0 + 10_000)).toEqual({
      kind: "gone",
    });
    expect(reconcileTrailing(LONG, [], T0 + 10_000)).toEqual({ kind: "gone" });
  });
});

describe("isFavourableOnChain", () => {
  it("refuses a candidate that is not better than the on-chain stop", () => {
    const onChain = [order({ oid: 424242, triggerPx: 70_000 })];
    // Better than the stored 68,600 but not than the on-chain 70,000.
    expect(isFavourableOnChain(LONG, 69_500, onChain)).toBe(false);
    expect(isFavourableOnChain(LONG, 70_000, onChain)).toBe(false);
    expect(isFavourableOnChain(LONG, 70_500, onChain)).toBe(true);
    expect(isFavourableOnChain(SHORT, 2050, [order({ oid: 424242, triggerPx: 2040 })])).toBe(false);
    expect(isFavourableOnChain(SHORT, 2030, [order({ oid: 424242, triggerPx: 2040 })])).toBe(true);
  });

  it("lets the stored check decide without a snapshot or without the stop in it", () => {
    expect(isFavourableOnChain(LONG, 69_000, undefined)).toBe(true);
    expect(isFavourableOnChain(LONG, 69_000, [order({ oid: 7, triggerPx: 80_000 })])).toBe(true);
  });
});

describe("planModifyCleanup", () => {
  // After a move from 68,600 to 70,658; the stop before the move was oid 424242.
  const moved = { ...LONG, stopPx: 70_658, previousOid: 424242 };

  it("cancels nothing when the exchange kept the oid", () => {
    const orders = [order({ oid: 424242, triggerPx: 70_658 })];
    expect(planModifyCleanup(moved, orders)).toEqual({ found: true });
  });

  it("adopts the new oid and cancels exactly the previous oid when it is still open", () => {
    const orders = [
      order({ oid: 424242, triggerPx: 68_600 }),
      order({ oid: 99, triggerPx: 70_658 }),
    ];
    expect(planModifyCleanup(moved, orders)).toEqual({
      found: true,
      adoptOid: 99,
      cancelOid: 424242,
    });
  });

  it("never selects a stop loss placed by hand, even when it is worse than the trailing stop", () => {
    const orders = [
      order({ oid: 99, triggerPx: 70_658 }),
      // A hand-placed hard stop at -10 %, and other orders of the coin and of another coin.
      order({ oid: 5, triggerPx: 63_000, isPositionTpsl: false }),
      order({ oid: 6, orderType: "Take Profit Market", triggerPx: 80_000 }),
      order({ oid: 7, coin: "ETH", triggerPx: 1000 }),
      order({ oid: 9, reduceOnly: false, triggerPx: 60_000 }),
    ];
    // The previous oid is gone already: nothing to cancel.
    expect(planModifyCleanup(moved, orders)).toEqual({ found: true, adoptOid: 99 });
    // With the previous oid open too, only that one is selected.
    expect(planModifyCleanup(moved, [...orders, order({ oid: 424242 })])).toEqual({
      found: true,
      adoptOid: 99,
      cancelOid: 424242,
    });
    // Without a previous oid (no move waiting), nothing is ever selected.
    const settled = { ...moved, previousOid: undefined };
    expect(planModifyCleanup(settled, [...orders, order({ oid: 424242 })])).toEqual({
      found: true,
      adoptOid: 99,
    });
  });

  it("does not cancel a previous oid that is better than the stored stop", () => {
    const orders = [
      order({ oid: 99, triggerPx: 70_658 }),
      order({ oid: 424242, triggerPx: 71_000 }),
    ];
    expect(planModifyCleanup(moved, orders)).toEqual({ found: true, adoptOid: 99 });
  });

  it("prefers a stop at the price that is not the previous oid", () => {
    // Both at the stored price: the new oid is the tracked one, the previous one goes.
    const orders = [
      order({ oid: 424242, triggerPx: 70_658 }),
      order({ oid: 99, triggerPx: 70_658 }),
    ];
    expect(planModifyCleanup({ ...moved, oid: 1 }, orders)).toEqual({
      found: true,
      adoptOid: 99,
      cancelOid: 424242,
    });
  });

  it("does nothing without a stop at the stored price, and asks to check again", () => {
    expect(planModifyCleanup(moved, [order({ oid: 424242, triggerPx: 68_600 })])).toEqual({
      found: false,
    });
  });

  it("mirrors for a short: a higher stop is worse", () => {
    const short = { ...SHORT, stopPx: 1938, previousOid: 424242 };
    const orders = [
      order({ coin: "ETH", side: "buy", oid: 77, triggerPx: 1938 }),
      order({ coin: "ETH", side: "buy", oid: 424242, triggerPx: 2040 }),
      order({ coin: "ETH", side: "buy", oid: 3, triggerPx: 2100 }),
    ];
    expect(planModifyCleanup(short, orders)).toEqual({
      found: true,
      adoptOid: 77,
      cancelOid: 424242,
    });
  });
});

describe("trailingConfigSchema previousOid", () => {
  it("keeps a stored previousOid and accepts a config without one", () => {
    const raw = JSON.stringify([{ ...LONG, previousOid: 7 }, SHORT]);
    expect(parseTrailingConfigs(raw)).toEqual([{ ...LONG, previousOid: 7 }, SHORT]);
  });
});

describe("trailingConfigSchema unsettled", () => {
  it("keeps unsettled and pendingStopPx", () => {
    const raw = JSON.stringify([
      { ...LONG, previousOid: 424242, unsettled: true, pendingStopPx: 70_658 },
    ]);
    expect(parseTrailingConfigs(raw)).toEqual([
      { ...LONG, previousOid: 424242, unsettled: true, pendingStopPx: 70_658 },
    ]);
  });
});

describe("trailingStopOids", () => {
  // After a move to 70,658: the config still holds the old oid 424242 until a reconcile adopts.
  const moved: TrailingConfig = { ...LONG, stopPx: 70_658, previousOid: 424242 };
  const hand = order({ oid: 5, triggerPx: 63_000, isPositionTpsl: false });

  it("finds the stored oid without a settling move", () => {
    expect(trailingStopOids(LONG, [order({ oid: 424242 }), hand])).toEqual({ tracked: 424242 });
  });

  it("finds a stop at the stored price when the stored oid is not open", () => {
    expect(trailingStopOids(LONG, [order({ oid: 99 }), hand])).toEqual({ tracked: 99 });
    expect(trailingStopOids(LONG, [hand])).toEqual({});
  });

  it("in the settle window, finds the moved stop under a new oid and the previous oid", () => {
    const book = [order({ oid: 424243, triggerPx: 70_658 }), order({ oid: 424242 }), hand];
    expect(trailingStopOids(moved, book)).toEqual({ tracked: 424243, previous: 424242 });
    expect(trailingStopOids(moved, [order({ oid: 424243, triggerPx: 70_658 }), hand])).toEqual({
      tracked: 424243,
    });
  });

  it("in the settle window, keeps the stored oid when the modify kept it", () => {
    expect(trailingStopOids(moved, [order({ oid: 424242, triggerPx: 70_658 }), hand])).toEqual({
      tracked: 424242,
    });
  });

  it("falls back to the stored oid when the book does not show the moved price", () => {
    expect(trailingStopOids(moved, [order({ oid: 424242 }), hand])).toEqual({ tracked: 424242 });
  });

  it("prefers the pending price of an unanswered move, then the stored price", () => {
    const unsettled = { ...LONG, previousOid: 424242, unsettled: true, pendingStopPx: 70_658 };
    expect(
      trailingStopOids(unsettled, [
        order({ oid: 424243, triggerPx: 70_658 }),
        order({ oid: 424242 }),
      ]),
    ).toEqual({ tracked: 424243, previous: 424242 });
    expect(trailingStopOids(unsettled, [order({ oid: 424242 })])).toEqual({ tracked: 424242 });
  });
});

describe("trailingRoleOf", () => {
  const moved: TrailingConfig = { ...LONG, stopPx: 70_658, previousOid: 424242 };
  const book = [
    order({ oid: 424243, triggerPx: 70_658 }),
    order({ oid: 424242 }),
    order({ oid: 5, triggerPx: 63_000, isPositionTpsl: false }),
  ];

  it("matches the moved stop at the stored price as the stop", () => {
    expect(trailingRoleOf(moved, [424243], book)).toBe("stop");
  });

  it("in the settle window, matches the stored oid (also the previous oid) as the stop", () => {
    // Every older snapshot showed 424242 as the trailing stop: the user wants the trailing stop gone.
    expect(trailingRoleOf(moved, [424242], book)).toBe("stop");
  });

  it("after a reconcile adopted the new oid, matches the previous oid as previous", () => {
    const adopted: TrailingConfig = { ...moved, oid: 424243 };
    expect(trailingRoleOf(adopted, [424242], book)).toBe("previous");
    expect(trailingRoleOf(adopted, [424243], book)).toBe("stop");
  });

  it("does not match a hand-placed stop", () => {
    expect(trailingRoleOf(moved, [5], book)).toBeNull();
  });

  it("matches the stored oid as the stop without a settling move, or without a book", () => {
    expect(trailingRoleOf(LONG, [424242], [order({ oid: 424242 })])).toBe("stop");
    expect(trailingRoleOf(moved, [424242], [])).toBe("stop");
  });
});

describe("trailingLabelOids", () => {
  const moved: TrailingConfig = { ...LONG, stopPx: 70_658, previousOid: 424242 };

  it("labels the live tracked stop after a move, not the old oid", () => {
    const book = [order({ oid: 424243, triggerPx: 70_658 }), order({ oid: 424242 })];
    expect([...trailingLabelOids([moved], book)]).toEqual([424243]);
  });

  it("labels the stored oid when the book does not show the stop", () => {
    expect([...trailingLabelOids([LONG], [])]).toEqual([424242]);
  });
});

describe("planTrailingCancel", () => {
  const moved: TrailingConfig = { ...LONG, stopPx: 70_658, previousOid: 424242 };
  const book = [
    order({ oid: 424243, triggerPx: 70_658 }),
    order({ oid: 424242 }),
    order({ oid: 5, triggerPx: 63_000, isPositionTpsl: false }),
  ];

  it("adds the open previous oid when the live tracked stop is cancelled", () => {
    expect(planTrailingCancel([moved], [424243], book)).toEqual({
      oids: [424243, 424242],
      ending: [{ coin: "BTC", stop: 424243 }],
    });
  });

  it("moved stop with new oid 424243, user cancels 424242: cancels both and ends the trailing", () => {
    expect(planTrailingCancel([moved], [424242], book)).toEqual({
      oids: [424242, 424243],
      ending: [{ coin: "BTC", stop: 424243 }],
    });
    // The old order is already gone from the book: the live stop is still added.
    expect(planTrailingCancel([moved], [424242], [book[0], book[2]])).toEqual({
      oids: [424242, 424243],
      ending: [{ coin: "BTC", stop: 424243 }],
    });
  });

  it("adds nothing that is already in the list, or not open", () => {
    expect(planTrailingCancel([moved], [424243, 424242], book).oids).toEqual([424243, 424242]);
    expect(planTrailingCancel([moved], [424243], [book[0], book[2]]).oids).toEqual([424243]);
  });

  it("does not end the trailing for a cancel of the previous oid after an adopt", () => {
    const adopted: TrailingConfig = { ...moved, oid: 424243 };
    expect(planTrailingCancel([adopted], [424242], book)).toEqual({
      oids: [424242],
      ending: [],
    });
  });

  it("adds nothing for a hand-placed stop, or without a config", () => {
    expect(planTrailingCancel([moved], [5], book)).toEqual({ oids: [5], ending: [] });
    expect(planTrailingCancel([], [424242], book)).toEqual({ oids: [424242], ending: [] });
  });

  it("ends the trailing with the stored oid when the book does not show the stop", () => {
    expect(planTrailingCancel([LONG], [424242], [])).toEqual({
      oids: [424242],
      ending: [{ coin: "BTC", stop: 424242 }],
    });
  });
});
