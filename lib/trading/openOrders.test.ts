import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { frontendOpenOrdersSchema } from "@/lib/hyperliquid/schemas";

import {
  groupOrdersByCoin,
  isCancelDone,
  isOrderGoneMessage,
  modifyResponseSchema,
  orderDisplayPx,
  orderTypeLabel,
  summarizeCancel,
} from "./openOrders";

function fixture(name: string) {
  return frontendOpenOrdersSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8")),
  );
}

const mainnet = fixture("frontendOpenOrders.json");
const testnet = fixture("testnet-frontendOpenOrders.json");

describe("frontendOpenOrdersSchema (fixtures)", () => {
  it("parses the real mainnet orders with numbers", () => {
    expect(mainnet).toHaveLength(9);
    const [first] = mainnet;
    expect(first).toMatchObject({
      coin: "VVV",
      side: "sell",
      limitPx: 20.327,
      sz: 24.16,
      origSz: 24.16,
      isTrigger: false,
      triggerPx: null,
      orderType: "Limit",
      tif: "Alo",
      reduceOnly: false,
    });
  });

  it("reads a position stop loss: size 0, trigger price, 10 % slippage limit", () => {
    const sl = mainnet.find((order) => order.coin === "BTC" && order.orderType === "Stop Market");
    expect(sl).toMatchObject({
      side: "sell",
      sz: 0,
      isTrigger: true,
      isPositionTpsl: true,
      reduceOnly: true,
      triggerPx: 73_354,
      triggerCondition: "Price below 73354",
      tif: null,
      cloid: null,
    });
    // 73,354 x 0.9 = 66,018.6, rounded down to 66,018.
    expect(sl?.limitPx).toBe(66_018);
  });

  it("parses the testnet fixture", () => {
    expect(testnet.map((order) => order.orderType)).toEqual([
      "Stop Market",
      "Take Profit Market",
      "Take Profit Limit",
      "Stop Market",
    ]);
  });

  it("keeps an unknown order type and tif as text", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures", "frontendOpenOrders.json"), "utf8"),
    );
    const parsed = frontendOpenOrdersSchema.parse([{ ...raw[0], orderType: "Scale", tif: "Gtd" }]);
    expect(parsed[0]?.orderType).toBe("Scale");
    expect(parsed[0]?.tif).toBe("Gtd");
  });

  it("rejects a bad side or a missing oid", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures", "frontendOpenOrders.json"), "utf8"),
    );
    expect(frontendOpenOrdersSchema.safeParse([{ ...raw[0], side: "X" }]).success).toBe(false);
    const withoutOid = { ...raw[0] };
    delete withoutOid.oid;
    expect(frontendOpenOrdersSchema.safeParse([withoutOid]).success).toBe(false);
  });
});

describe("summarizeCancel", () => {
  it("reads success and error statuses", () => {
    const body = {
      status: "ok",
      response: {
        type: "cancel",
        data: {
          statuses: ["success", { error: "Order was never placed, already canceled, or filled." }],
        },
      },
    };
    expect(summarizeCancel(body)).toEqual([
      { kind: "success" },
      { kind: "error", message: "Order was never placed, already canceled, or filled." },
    ]);
  });

  it("gives null for another body", () => {
    expect(summarizeCancel({ status: "err", response: "x" })).toBeNull();
    expect(summarizeCancel(null)).toBeNull();
  });
});

describe("modifyResponseSchema", () => {
  it("reads both shapes", () => {
    expect(
      modifyResponseSchema.safeParse({ status: "ok", response: { type: "default" } }).success,
    ).toBe(true);
    expect(
      modifyResponseSchema.safeParse({ status: "err", response: "Cannot modify" }).success,
    ).toBe(true);
    expect(
      modifyResponseSchema.safeParse({ status: "ok", response: { type: "order" } }).success,
    ).toBe(false);
  });
});

describe("isOrderGoneMessage", () => {
  it.each([
    ["Order was never placed, already canceled, or filled.", true],
    ["Cannot modify canceled or filled order", true],
    ["Order not found", true],
    ["User or API Wallet 0xabc does not exist.", false],
    ["Insufficient margin to place order.", false],
    [undefined, false],
  ])("%j: %s", (text, expected) => {
    expect(isOrderGoneMessage(text)).toBe(expected);
  });
});

describe("labels and groups", () => {
  it("labels limit, TP, SL and a trailing stop", () => {
    const labels = mainnet.map((order) => orderTypeLabel(order, new Set()));
    expect(labels.filter((label) => label === "Limit")).toHaveLength(5);
    expect(labels).toContain("Take profit");
    expect(labels).toContain("Stop loss");
    const sl = mainnet.find((order) => order.coin === "BTC" && order.orderType === "Stop Market");
    if (!sl) throw new Error("fixture");
    expect(orderTypeLabel(sl, new Set([sl.oid]))).toBe("Trailing stop");
    expect(orderDisplayPx(sl)).toBe(73_354);
    const limit = mainnet[0];
    if (!limit) throw new Error("fixture");
    expect(orderDisplayPx(limit)).toBe(20.327);
  });

  it("groups by coin, A to Z, newest first", () => {
    const groups = groupOrdersByCoin(mainnet);
    expect(groups.map((group) => group.coin)).toEqual(
      [...groups.map((group) => group.coin)].sort(),
    );
    const btc = groups.find((group) => group.coin === "BTC");
    expect(btc?.orders).toHaveLength(2);
    const times = btc?.orders.map((order) => order.timestamp) ?? [];
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe("isCancelDone", () => {
  it("counts a success and an order that is already gone as done", () => {
    expect(isCancelDone({ kind: "success" })).toBe(true);
    expect(
      isCancelDone({
        kind: "error",
        message: "Order was never placed, already canceled, or filled.",
      }),
    ).toBe(true);
  });

  it("does not count another error or a missing status", () => {
    expect(isCancelDone({ kind: "error", message: "Rate limited." })).toBe(false);
    expect(isCancelDone(undefined)).toBe(false);
  });
});
