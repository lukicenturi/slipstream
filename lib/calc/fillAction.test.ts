import { describe, expect, it } from "vitest";

import { describeFillAction, isSystemFill, sideLabel } from "./fillAction";

describe("describeFillAction", () => {
  it.each([
    ["Open Long", "opened long", "opened", "long"],
    ["Open Short", "opened short", "opened", "short"],
    ["Close Long", "closed long", "closed", "long"],
    ["Close Short", "closed short", "closed", "short"],
    ["Long > Short", "flipped to short", "flipped", "short"],
    ["Short > Long", "flipped to long", "flipped", "long"],
    ["Buy", "bought", "bought", null],
    ["Sell", "sold", "sold", null],
    ["Liquidated Isolated Long", "was liquidated", "liquidated", "long"],
    ["Liquidated Cross Short", "was liquidated", "liquidated", "short"],
    ["Auto-Deleveraging", "auto-deleveraging", "auto-deleveraging", null],
  ])("maps %s", (dir, phrase, verb, positionSide) => {
    expect(describeFillAction(dir)).toEqual({ phrase, verb, positionSide });
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

describe("isSystemFill", () => {
  it("is true for a spot dust conversion", () => {
    expect(isSystemFill("Spot Dust Conversion")).toBe(true);
  });

  it("is false for trades of the user", () => {
    expect(isSystemFill("Open Long")).toBe(false);
    expect(isSystemFill("Buy")).toBe(false);
  });
});
