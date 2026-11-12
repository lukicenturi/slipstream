import { afterEach, describe, expect, it, vi } from "vitest";

import { NETWORK } from "@/lib/network";
import { trailingStorageKey, type TrailingConfig } from "@/lib/trading/trailing";

/*
 * A write for one coin must not restore a stale entry of another coin:
 * `updateTrailingConfigs` reads localStorage again before it runs the
 * updater. A fake window with an in-memory localStorage stands in for the
 * browser (no `storage` event reaches this tab, as when another tab wrote
 * a moment ago).
 */

const OWNER = "0x00000000000000000000000000000000000000aa";
const T0 = 1_794_400_000_000;

const BTC: TrailingConfig = {
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
const ETH: TrailingConfig = { ...BTC, coin: "ETH", assetIndex: 4, oid: 7, stopPx: 1_960 };

function fakeWindow() {
  const data = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  return { localStorage, addEventListener: () => {}, removeEventListener: () => {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("updateTrailingConfigs", () => {
  it("reads storage again first, so another tab's write for another coin stays", async () => {
    const win = fakeWindow();
    vi.stubGlobal("window", win);
    const { readTrailingConfigs, updateTrailingConfigs } = await import("./useTrailingStops");
    const key = trailingStorageKey(NETWORK, OWNER);

    updateTrailingConfigs(OWNER, () => [BTC, ETH]);
    expect(readTrailingConfigs(OWNER)).toEqual([BTC, ETH]);

    // Another tab ends the ETH trailing a moment ago; this tab's cache still has it.
    win.localStorage.setItem(key, JSON.stringify([BTC]));

    // This tab moves the BTC stop under the BTC lock.
    updateTrailingConfigs(OWNER, (list) =>
      list.map((config) => (config.coin === "BTC" ? { ...config, stopPx: 70_658 } : config)),
    );
    expect(JSON.parse(win.localStorage.getItem(key) ?? "[]")).toEqual([{ ...BTC, stopPx: 70_658 }]);
  });
});
