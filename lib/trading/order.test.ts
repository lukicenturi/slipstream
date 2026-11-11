import { describe, expect, it } from "vitest";

import type { PerpAsset } from "@/lib/hyperliquid/schemas";

import {
  assertWithinCap,
  buildCloseOrder,
  buildIocOrder,
  closeFraction,
  closePreview,
  CloseTooSmallError,
  clampLeverage,
  findAsset,
  leverageUpdate,
  limitPrice,
  orderBlockReason,
  OrderTooLargeError,
  OrderTooSmallError,
  roundPrice,
  roundSize,
  summarizeOrderResponse,
  summarizeOrderStatuses,
} from "./order";

const BTC: PerpAsset = {
  index: 3,
  name: "BTC",
  szDecimals: 5,
  maxLeverage: 40,
  onlyIsolated: false,
  isDelisted: false,
};
const DOGE: PerpAsset = {
  index: 6,
  name: "DOGE",
  szDecimals: 0,
  maxLeverage: 10,
  onlyIsolated: false,
  isDelisted: false,
};

describe("findAsset", () => {
  it("finds by exact name and returns null otherwise", () => {
    expect(findAsset([BTC, DOGE], "BTC")).toBe(BTC);
    expect(findAsset([BTC, DOGE], "btc")).toBeNull();
    expect(findAsset([BTC, DOGE], "xyz:NVDA")).toBeNull();
  });
});

describe("roundPrice", () => {
  it("follows the documented examples", () => {
    expect(roundPrice(97123.456789, 0)).toBe("97123");
    expect(roundPrice(1.23456789, 5)).toBe("1.2");
    expect(roundPrice(1234.5, 0)).toBe("1234.5");
  });

  it("keeps at most 5 significant figures, rounded down", () => {
    expect(roundPrice(1234.56, 0)).toBe("1234.5");
    expect(roundPrice(75404.075, 5)).toBe("75404");
  });

  it("keeps at most 6 - szDecimals decimals", () => {
    expect(roundPrice(0.0679812, 0)).toBe("0.067981");
    expect(roundPrice(0.0679812, 2)).toBe("0.0679");
  });

  it("allows integer prices above 5 significant figures", () => {
    expect(roundPrice(123456, 5)).toBe("123456");
  });
});

describe("roundSize", () => {
  it("rounds down to szDecimals", () => {
    expect(roundSize(1.23456789, 5)).toBe("1.23456");
    expect(roundSize(14.99, 0)).toBe("14");
  });

  it("throws when the size rounds to 0", () => {
    expect(() => roundSize(0.000001, 5)).toThrow();
  });
});

describe("clampLeverage", () => {
  it("keeps a whole leverage inside [1, max]", () => {
    expect(clampLeverage(50, 40)).toBe(40);
    expect(clampLeverage(0, 40)).toBe(1);
    expect(clampLeverage(4.6, 40)).toBe(5);
    expect(clampLeverage(Number.NaN, 40)).toBe(1);
    expect(clampLeverage(10, 0)).toBe(1);
  });
});

describe("buildIocOrder", () => {
  it("buys a long 1 % above the mid", () => {
    const order = buildIocOrder({
      assetIndex: 3,
      szDecimals: 5,
      side: "long",
      sizeUsd: 1000,
      mid: 74657.5,
    });
    // 74657.5 * 1.01 = 75404.075 -> 5 significant figures, rounded down.
    expect(order).toEqual({
      a: 3,
      b: true,
      p: "75404",
      s: "0.01339",
      r: false,
      t: { limit: { tif: "Ioc" } },
    });
  });

  it("sells a short 1 % below the mid", () => {
    const order = buildIocOrder({
      assetIndex: 4,
      szDecimals: 4,
      side: "short",
      sizeUsd: 500,
      mid: 2015.05,
    });
    // 2015.05 * 0.99 = 1994.8995 -> 1994.8. 500 / 2015.05 = 0.248133... -> 0.2481.
    expect(order.b).toBe(false);
    expect(order.p).toBe("1994.8");
    expect(order.s).toBe("0.2481");
    expect(Number(order.p)).toBeLessThan(2015.05);
  });

  it("uses a custom slippage", () => {
    const order = buildIocOrder({
      assetIndex: 3,
      szDecimals: 5,
      side: "long",
      sizeUsd: 1000,
      mid: 100000,
      slippage: 0.05,
    });
    expect(order.p).toBe("105000");
  });

  it("throws OrderTooSmallError below $10", () => {
    expect(() =>
      buildIocOrder({ assetIndex: 3, szDecimals: 5, side: "long", sizeUsd: 9, mid: 74000 }),
    ).toThrow(OrderTooSmallError);
  });

  it("throws OrderTooSmallError when rounding drops the notional below $10", () => {
    // 15 / 0.068 = 220.6 DOGE -> 220 DOGE = $14.96, fine. 15 / 9 = 1.66 -> 1 coin = $9.
    expect(() =>
      buildIocOrder({ assetIndex: 6, szDecimals: 0, side: "long", sizeUsd: 15, mid: 9 }),
    ).toThrow(OrderTooSmallError);
  });

  it("throws OrderTooSmallError when the size rounds to 0", () => {
    expect(() =>
      buildIocOrder({ assetIndex: 6, szDecimals: 0, side: "long", sizeUsd: 50, mid: 100 }),
    ).toThrow(OrderTooSmallError);
  });

  it("throws without a mid", () => {
    expect(() =>
      buildIocOrder({ assetIndex: 3, szDecimals: 5, side: "long", sizeUsd: 100, mid: 0 }),
    ).toThrow(/mid/);
  });
});

describe("summarizeOrderStatuses", () => {
  it("reads a fill", () => {
    expect(
      summarizeOrderStatuses([{ filled: { totalSz: "0.0136", avgPx: "74650.0", oid: 77738308 } }]),
    ).toEqual({ kind: "filled", totalSz: 0.0136, avgPx: 74650, oid: 77738308 });
  });

  it("reads a resting order", () => {
    expect(summarizeOrderStatuses([{ resting: { oid: 77738308 } }])).toEqual({
      kind: "resting",
      oid: 77738308,
    });
  });

  it("reads a per-order error", () => {
    expect(
      summarizeOrderStatuses([{ error: "Insufficient margin to place order. asset=3" }]),
    ).toEqual({ kind: "error", message: "Insufficient margin to place order. asset=3" });
  });

  it("handles an empty or unknown status list", () => {
    expect(summarizeOrderStatuses([]).kind).toBe("error");
    expect(summarizeOrderStatuses(["waitingForFill"]).kind).toBe("error");
    expect(summarizeOrderStatuses(null).kind).toBe("error");
  });
});

describe("summarizeOrderResponse", () => {
  it("reads the statuses of a full response body", () => {
    const body = {
      status: "ok",
      response: {
        type: "order",
        data: { statuses: [{ error: "Order must have minimum value of $10." }] },
      },
    };
    expect(summarizeOrderResponse(body)).toEqual({
      kind: "error",
      message: "Order must have minimum value of $10.",
    });
  });

  it("returns null for a top-level error", () => {
    expect(summarizeOrderResponse({ status: "err", response: "Must deposit" })).toBeNull();
  });
});

describe("orderBlockReason", () => {
  const base = {
    network: "testnet" as const,
    asset: BTC,
    mid: 74000,
    balanceUsd: 500,
    sizeUsd: 1000,
    leverage: 5,
    maxOrderUsd: 10_000,
  };

  it("allows a funded order", () => {
    expect(orderBlockReason(base)).toBeNull();
  });

  it("blocks an asset that is not listed or delisted", () => {
    expect(orderBlockReason({ ...base, asset: null })).toBe("Not listed on testnet.");
    expect(orderBlockReason({ ...base, asset: { ...BTC, isDelisted: true } })).toMatch(/Delisted/);
  });

  it("blocks without a price or a balance", () => {
    expect(orderBlockReason({ ...base, mid: undefined })).toMatch(/price/);
    expect(orderBlockReason({ ...base, balanceUsd: undefined })).toMatch(/Loading/);
    expect(orderBlockReason({ ...base, balanceUsd: 0 })).toBe("No testnet balance.");
  });

  it("blocks a margin above the balance and a size below $10", () => {
    expect(orderBlockReason({ ...base, leverage: 1 })).toMatch(/margin/);
    expect(orderBlockReason({ ...base, sizeUsd: 5 })).toMatch(/\$10/);
  });

  it("blocks a size above the cap", () => {
    expect(orderBlockReason({ ...base, maxOrderUsd: 500 })).toBe(
      "The size is above your cap of $500.",
    );
    expect(orderBlockReason({ ...base, sizeUsd: 500, maxOrderUsd: 500 })).toBeNull();
  });

  it("names the network", () => {
    const mainnet = { ...base, network: "mainnet" as const };
    expect(orderBlockReason({ ...mainnet, asset: null })).toBe("Not listed on mainnet.");
    expect(orderBlockReason({ ...mainnet, balanceUsd: 0 })).toBe("No mainnet balance.");
  });
});

describe("assertWithinCap", () => {
  it("passes at or below the cap and throws above it", () => {
    expect(() => assertWithinCap(500, 500)).not.toThrow();
    expect(() => assertWithinCap(10, 500)).not.toThrow();
    expect(() => assertWithinCap(500.01, 500)).toThrow(OrderTooLargeError);
    expect(() => assertWithinCap(Number.NaN, 500)).toThrow("The order is above your cap of $500.");
  });
});

describe("limitPrice", () => {
  it("is the worst fill price, 1 % through the mid, rounded down", () => {
    expect(limitPrice({ mid: 74000, side: "long", slippage: 0.01, szDecimals: 5 })).toBe("74740");
    expect(limitPrice({ mid: 74000, side: "short", slippage: 0.01, szDecimals: 5 })).toBe("73260");
  });

  it("matches the price of the built order", () => {
    const order = buildIocOrder({
      assetIndex: 3,
      szDecimals: 5,
      side: "long",
      sizeUsd: 500,
      mid: 74123.4,
      slippage: 0.01,
    });
    expect(order.p).toBe(limitPrice({ mid: 74123.4, side: "long", slippage: 0.01, szDecimals: 5 }));
  });
});

describe("leverageUpdate", () => {
  it("sets cross leverage when there is no position", () => {
    expect(leverageUpdate({ asset: BTC, leverage: 5, position: undefined })).toEqual({
      isCross: true,
    });
  });

  it("uses isolated margin for an isolated-only asset", () => {
    expect(
      leverageUpdate({ asset: { onlyIsolated: true }, leverage: 5, position: undefined }),
    ).toEqual({ isCross: false });
  });

  it("skips the update when the position already has the leverage", () => {
    expect(
      leverageUpdate({ asset: BTC, leverage: 5, position: { leverage: 5, leverageType: "cross" } }),
    ).toBeNull();
  });

  it("keeps the margin mode of an open position", () => {
    expect(
      leverageUpdate({
        asset: BTC,
        leverage: 10,
        position: { leverage: 5, leverageType: "isolated" },
      }),
    ).toEqual({ isCross: false });
  });
});

describe("closeFraction", () => {
  it("turns a whole percent into a share and clamps it", () => {
    expect(closeFraction(100)).toBe(1);
    expect(closeFraction(25)).toBe(0.25);
    expect(closeFraction(0)).toBe(0.01);
    expect(closeFraction(140)).toBe(1);
    expect(closeFraction(Number.NaN)).toBe(1);
  });
});

describe("buildCloseOrder", () => {
  const btc = { assetIndex: 0, szDecimals: 5, mid: 100_000 };

  it("closes a long with a reduce-only sell below the mid", () => {
    const order = buildCloseOrder({ ...btc, positionSide: "long", positionSize: 0.5, fraction: 1 });
    expect(order).toEqual({
      a: 0,
      b: false,
      p: "99000",
      s: "0.5",
      r: true,
      t: { limit: { tif: "Ioc" } },
    });
  });

  it("closes a short with a reduce-only buy above the mid", () => {
    const order = buildCloseOrder({
      ...btc,
      positionSide: "short",
      positionSize: 0.5,
      fraction: 1,
    });
    expect(order.b).toBe(true);
    expect(order.p).toBe("101000");
    expect(order.r).toBe(true);
  });

  it("closes a share of the position, rounded down to the size decimals", () => {
    const order = buildCloseOrder({
      assetIndex: 3,
      szDecimals: 2,
      mid: 150,
      positionSide: "long",
      positionSize: 10.37,
      fraction: 0.5,
    });
    expect(order.s).toBe("5.18");
  });

  it("rejects a partial close below $10 but allows a small full close", () => {
    const small = { ...btc, positionSide: "long" as const, positionSize: 0.00015 };
    expect(() => buildCloseOrder({ ...small, fraction: 0.5 })).toThrow(CloseTooSmallError);
    expect(buildCloseOrder({ ...small, fraction: 1 }).s).toBe("0.00015");
  });

  it("rejects a size that rounds to 0 and a missing mid", () => {
    expect(() =>
      buildCloseOrder({ ...btc, positionSide: "long", positionSize: 0.000001, fraction: 1 }),
    ).toThrow(CloseTooSmallError);
    expect(() =>
      buildCloseOrder({ ...btc, mid: 0, positionSide: "long", positionSize: 1, fraction: 1 }),
    ).toThrow();
  });
});

describe("closePreview", () => {
  it("shows the size, the worst price and the PnL that the close realises", () => {
    const preview = closePreview({
      assetIndex: 0,
      szDecimals: 5,
      mid: 110,
      entryPx: 100,
      positionSide: "long",
      positionSize: 2,
      fraction: 0.5,
    });
    expect(preview).toEqual({ sizeCoin: 1, sizeUsd: 110, worstPrice: 108.9, estPnl: 10 });
  });

  it("gives a short a gain when the price falls", () => {
    const preview = closePreview({
      assetIndex: 0,
      szDecimals: 2,
      mid: 90,
      entryPx: 100,
      positionSide: "short",
      positionSize: 3,
      fraction: 1,
    });
    expect(preview?.estPnl).toBe(30);
    expect(preview?.worstPrice).toBe(90.9);
  });

  it("still previews a partial close below the minimum, and returns null without a mid", () => {
    const base = {
      assetIndex: 0,
      szDecimals: 5,
      entryPx: 100_000,
      positionSide: "long" as const,
      positionSize: 0.00015,
    };
    expect(closePreview({ ...base, mid: 100_000, fraction: 0.5 })?.sizeCoin).toBeCloseTo(0.000075);
    expect(closePreview({ ...base, mid: 0, fraction: 1 })).toBeNull();
  });
});
