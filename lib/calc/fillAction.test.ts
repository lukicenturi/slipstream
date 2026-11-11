import { describe, expect, it } from "vitest";

import { describeFillAction, sideLabel } from "./fillAction";

describe("describeFillAction", () => {
  it.each([
    ["Open Long", "opened long", "long"],
    ["Open Short", "opened short", "short"],
    ["Close Long", "closed long", "long"],
    ["Close Short", "closed short", "short"],
    ["Long > Short", "flipped to short", "short"],
    ["Short > Long", "flipped to long", "long"],
    ["Buy", "bought", null],
    ["Sell", "sold", null],
    ["Liquidated Isolated Long", "was liquidated", "long"],
    ["Liquidated Cross Short", "was liquidated", "short"],
    ["Auto-Deleveraging", "auto-deleveraging", null],
  ])("maps %s", (dir, phrase, positionSide) => {
    expect(describeFillAction(dir)).toEqual({ phrase, positionSide });
  });
});

describe("sideLabel", () => {
  it("uses the position side when it is known", () => {
    expect(sideLabel(describeFillAction("Close Long"), "sell")).toEqual({
      label: "Long",
      tone: "long",
    });
  });
  it("falls back to buy and sell", () => {
    expect(sideLabel(describeFillAction("Sell"), "sell")).toEqual({ label: "Sell", tone: "short" });
    expect(sideLabel(describeFillAction("Buy"), "buy")).toEqual({ label: "Buy", tone: "long" });
  });
});
