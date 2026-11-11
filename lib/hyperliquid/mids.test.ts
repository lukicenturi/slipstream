import { describe, expect, it, vi } from "vitest";

import { createMidsStore } from "./mids";

describe("mids store", () => {
  it("stores values and notifies only the coins that changed", () => {
    const store = createMidsStore();
    const btc = vi.fn();
    const eth = vi.fn();
    const all = vi.fn();
    store.subscribe("BTC", btc);
    store.subscribe("ETH", eth);
    store.subscribeAll(all);

    store.ingest({ BTC: 100, ETH: 10 });
    expect(store.get("BTC")).toBe(100);
    expect(btc).toHaveBeenCalledTimes(1);
    expect(eth).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);

    store.ingest({ BTC: 101, ETH: 10 });
    expect(btc).toHaveBeenCalledTimes(2);
    expect(eth).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(2);

    store.ingest({ BTC: 101, ETH: 10 });
    expect(all).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createMidsStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe("SOL", listener);
    unsubscribe();
    store.ingest({ SOL: 1 });
    expect(listener).not.toHaveBeenCalled();
    expect(store.get("DOGE")).toBeUndefined();
  });
});
