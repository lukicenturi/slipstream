import { describe, expect, it } from "vitest";

import { displaySymbol, iconSymbol, iconUrl, monogram } from "./assets";

describe("iconSymbol", () => {
  it("upper-cases perp coins", () => {
    expect(iconSymbol("BTC")).toBe("BTC");
    expect(iconSymbol("hype")).toBe("HYPE");
  });

  it("drops the k prefix of 1,000-unit coins", () => {
    expect(iconSymbol("kPEPE")).toBe("PEPE");
    expect(iconSymbol("kSHIB")).toBe("SHIB");
  });

  it("returns null for other DEXs, spot and builder ids", () => {
    expect(iconSymbol("xyz:NVDA")).toBeNull();
    expect(iconSymbol("@107")).toBeNull();
    expect(iconSymbol("#114910")).toBeNull();
    expect(iconSymbol("")).toBeNull();
  });
});

describe("displaySymbol", () => {
  it("strips a dex prefix only", () => {
    expect(displaySymbol("xyz:NVDA")).toBe("NVDA");
    expect(displaySymbol("BTC")).toBe("BTC");
    expect(displaySymbol("@107")).toBe("@107");
  });
});

describe("iconUrl and monogram", () => {
  it("builds the icon URL", () => {
    expect(iconUrl("BTC")).toBe("https://app.hyperliquid.xyz/coins/BTC.svg");
  });

  it("uses the first 2 letters or digits", () => {
    expect(monogram("BTC")).toBe("BT");
    expect(monogram("xyz:NVDA")).toBe("NV");
    expect(monogram("@107")).toBe("10");
    expect(monogram("kPEPE")).toBe("KP");
    expect(monogram("@")).toBe("?");
  });
});
