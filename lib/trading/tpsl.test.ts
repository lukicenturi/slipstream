import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { frontendOpenOrdersSchema } from "@/lib/hyperliquid/schemas";

import {
  buildTriggerOrder,
  classifyOpenOrder,
  levelInputText,
  parsePriceInput,
  pnlAtPrice,
  positionTpsl,
  quickLevels,
  triggerLimitPx,
  triggerSide,
  TriggerSizeError,
  validateTriggerPx,
} from "./tpsl";
import { trailingLabelOids, type TrailingConfig } from "./trailing";

const orders = frontendOpenOrdersSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), "fixtures", "frontendOpenOrders.json"), "utf8")),
);

describe("triggerSide", () => {
  it("closes a long with a sell and a short with a buy", () => {
    expect(triggerSide("long")).toBe("short");
    expect(triggerSide("short")).toBe("long");
  });
});

describe("validateTriggerPx", () => {
  const mid = 70_000;
  it.each([
    ["tp", "long", 77_000, null],
    ["tp", "long", 66_000, "A take profit for a long must be above the current price."],
    ["sl", "long", 66_000, null],
    ["sl", "long", 71_000, "A stop loss for a long must be below the current price."],
    ["tp", "short", 66_000, null],
    ["tp", "short", 71_000, "A take profit for a short must be below the current price."],
    ["sl", "short", 71_000, null],
    ["sl", "short", 69_000, "A stop loss for a short must be above the current price."],
  ] as const)("%s for a %s at %d", (kind, positionSide, triggerPx, expected) => {
    expect(validateTriggerPx({ kind, positionSide, triggerPx, mid })).toBe(expected);
  });

  it("refuses the mid itself, a price inside 0.1 %, 0, NaN and an unknown mid", () => {
    const base = { kind: "tp", positionSide: "long" } as const;
    expect(validateTriggerPx({ ...base, triggerPx: mid, mid })).toMatch(/must be above/);
    expect(validateTriggerPx({ ...base, triggerPx: 70_050, mid })).toBe(
      "Too close to the current price.",
    );
    expect(validateTriggerPx({ ...base, triggerPx: 70_070, mid })).toBeNull();
    expect(validateTriggerPx({ ...base, triggerPx: 0, mid })).toBe("Enter a price above 0.");
    expect(validateTriggerPx({ ...base, triggerPx: Number.NaN, mid })).toBe(
      "Enter a price above 0.",
    );
    expect(validateTriggerPx({ ...base, triggerPx: 77_000, mid: undefined })).toBe(
      "Waiting for the price.",
    );
  });
});

describe("buildTriggerOrder", () => {
  const base = { assetIndex: 3, szDecimals: 5, positionSize: 0.01 } as const;

  it("builds a reduce-only market sell TP for a long, 10 % through the trigger", () => {
    expect(
      buildTriggerOrder({ ...base, positionSide: "long", kind: "tp", triggerPx: 77_000 }),
    ).toEqual({
      a: 3,
      b: false,
      p: "69300",
      s: "0.01",
      r: true,
      t: { trigger: { isMarket: true, triggerPx: "77000", tpsl: "tp" } },
    });
  });

  it("builds a buy SL for a short with p 10 % above the trigger", () => {
    const order = buildTriggerOrder({
      ...base,
      positionSize: -0.123456,
      positionSide: "short",
      kind: "sl",
      triggerPx: 73_500,
    });
    expect(order.b).toBe(true);
    expect(order.s).toBe("0.12345");
    expect(order.t.trigger).toEqual({ isMarket: true, triggerPx: "73500", tpsl: "sl" });
    expect(order.p).toBe("80850");
    expect(order.r).toBe(true);
  });

  it("rounds both prices down to 5 significant figures and the size down", () => {
    const order = buildTriggerOrder({
      assetIndex: 1,
      szDecimals: 4,
      positionSide: "long",
      positionSize: 1.23456,
      kind: "sl",
      triggerPx: 1987.654321,
    });
    expect(order.t.trigger.triggerPx).toBe("1987.6");
    expect(order.p).toBe(
      triggerLimitPx({ triggerPx: 1987.6, positionSide: "long", szDecimals: 4 }),
    );
    expect(order.p).toBe("1788.8");
    expect(order.s).toBe("1.2345");
  });

  it("throws when the size rounds to 0", () => {
    expect(() =>
      buildTriggerOrder({
        ...base,
        positionSize: 0.000001,
        positionSide: "long",
        kind: "tp",
        triggerPx: 1,
      }),
    ).toThrow(TriggerSizeError);
  });
});

describe("quickLevels", () => {
  it("gives TP levels above and SL levels below the entry of a long", () => {
    expect(quickLevels("tp", "long", 70_000)).toEqual([
      { pct: 5, label: "+5%", px: 73_500 },
      { pct: 10, label: "+10%", px: 70_000 * 1.1 },
      { pct: 25, label: "+25%", px: 87_500 },
      { pct: 50, label: "+50%", px: 105_000 },
    ]);
    expect(quickLevels("sl", "long", 70_000, 5).map((level) => [level.label, level.px])).toEqual([
      ["−2%", 68_600],
      ["−5%", 66_500],
      ["−10%", 63_000],
      ["−25%", 52_500],
    ]);
  });

  it("flips the signs for a short and rounds with szDecimals", () => {
    expect(quickLevels("tp", "short", 2000, 4).map((level) => [level.label, level.px])).toEqual([
      ["−5%", 1900],
      ["−10%", 1800],
      ["−25%", 1500],
      ["−50%", 1000],
    ]);
    expect(quickLevels("sl", "short", 2000, 4)[0]).toEqual({ pct: 2, label: "+2%", px: 2040 });
  });

  it("gives nothing without an entry", () => {
    expect(quickLevels("tp", "long", 0)).toEqual([]);
  });
});

describe("pnlAtPrice", () => {
  it("gives the PnL and the ROE of a full close at a price", () => {
    const long = { side: "long", size: 0.01, entryPx: 70_000, leverage: 10 } as const;
    expect(pnlAtPrice(long, 77_000)).toEqual({ pnl: 70, roe: 1 });
    const short = { side: "short", size: -2, entryPx: 100, leverage: 5 } as const;
    expect(pnlAtPrice(short, 110)).toEqual({ pnl: -20, roe: -0.5 });
    expect(pnlAtPrice(long, Number.NaN)).toBeNull();
  });
});

describe("classifyOpenOrder and positionTpsl (fixture)", () => {
  it("reads the order types of the real response", () => {
    const kinds = orders.map((order) => [order.orderType, classifyOpenOrder(order)]);
    expect(kinds).toContainEqual(["Limit", { kind: "limit", market: false }]);
    expect(kinds).toContainEqual(["Stop Market", { kind: "sl", market: true }]);
    expect(kinds).toContainEqual(["Take Profit Market", { kind: "tp", market: true }]);
    expect(kinds).toContainEqual(["Stop Limit", { kind: "sl", market: false }]);
    expect(classifyOpenOrder({ orderType: "Twap Slice", isTrigger: false }).kind).toBe("other");
  });

  it("finds the position TP and SL of BTC", () => {
    const { tp, sl } = positionTpsl(orders, "BTC");
    expect(tp?.oid).toBe(orders.find((order) => order.orderType === "Take Profit Market")?.oid);
    expect(tp?.triggerPx).toBe(120_000);
    expect(sl?.isPositionTpsl).toBe(true);
    expect(sl?.triggerPx).toBe(73_354);
  });

  it("gives null for a coin without trigger orders", () => {
    expect(positionTpsl(orders, "HYPE")).toEqual({ tp: null, sl: null });
    expect(positionTpsl(undefined, "BTC")).toEqual({ tp: null, sl: null });
  });

  it("prefers a position TP/SL over an older plain stop", () => {
    const sl = orders.find((order) => order.coin === "BTC" && order.orderType === "Stop Market");
    if (!sl) throw new Error("fixture");
    const plain = { ...sl, oid: 1, isPositionTpsl: false, timestamp: sl.timestamp - 1000 };
    expect(positionTpsl([plain, sl], "BTC").sl?.oid).toBe(sl.oid);
  });

  it("prefers the live tracked trailing stop over the older order that its move left behind", () => {
    const base = orders.find((order) => order.coin === "BTC" && order.orderType === "Stop Market");
    if (!base) throw new Error("fixture");
    // The settle window after a move: the old order 424242 is still open next to the moved stop.
    const old = {
      ...base,
      oid: 424242,
      isPositionTpsl: false,
      timestamp: base.timestamp - 60_000,
      triggerPx: (base.triggerPx ?? 0) - 2_000,
    };
    const moved = { ...base, oid: 424243, isPositionTpsl: false, timestamp: base.timestamp };
    const trailing: TrailingConfig = {
      coin: "BTC",
      positionSide: "long",
      trailPct: 0.02,
      assetIndex: 3,
      szDecimals: 5,
      size: 0.01,
      oid: 424242,
      previousOid: 424242,
      stopPx: moved.triggerPx ?? 0,
      highWater: 76_000,
      createdAt: base.timestamp - 120_000,
      updatedAt: base.timestamp,
      lastModifyAt: base.timestamp,
    };
    expect(positionTpsl([old, moved], "BTC").sl?.oid).toBe(424242);
    const prefer = trailingLabelOids([trailing], [old, moved]);
    expect(positionTpsl([old, moved], "BTC", prefer).sl?.oid).toBe(424243);
  });
});

describe("parsePriceInput", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["77,000", 77_000],
    ["1987.5", 1987.5],
    [".5", 0.5],
    ["abc", Number.NaN],
    ["1.2.3", Number.NaN],
    [".", Number.NaN],
  ])("%j gives %s", (text, expected) => {
    expect(parsePriceInput(text)).toEqual(expected);
  });
});

describe("levelInputText", () => {
  it("writes the rounded price, never a float tail", () => {
    // 1,987.65 x 1.1 is 2186.4150000000004 in floating point.
    expect(String(1987.65 * 1.1)).toBe("2186.4150000000004");
    expect(levelInputText(1987.65 * 1.1, 4)).toBe("2186.4");
    expect(levelInputText(3.3 * 1.5, 2)).not.toContain("99999");
    expect(levelInputText(70_000 * 1.1, 5)).toBe("77000");
  });

  it("uses 5 significant figures before the markets load", () => {
    expect(levelInputText(1987.65 * 1.1, undefined)).toBe("2186.4");
    expect(levelInputText(0.123456789, undefined)).toBe("0.12346");
  });

  it("gives an empty text for a bad price", () => {
    expect(levelInputText(Number.NaN, 5)).toBe("");
    expect(levelInputText(0, 5)).toBe("");
  });

  it("matches the chip price, so the chip shows as pressed", () => {
    for (const level of quickLevels("tp", "long", 70_000, 5)) {
      expect(parsePriceInput(levelInputText(level.px, 5))).toBe(level.px);
    }
  });
});
