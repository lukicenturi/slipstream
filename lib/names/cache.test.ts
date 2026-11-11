import { describe, expect, it } from "vitest";

import { TtlCache } from "./cache";

describe("TtlCache", () => {
  it("returns a value until it expires", () => {
    const cache = new TtlCache<string>();
    cache.set("a", "1", 1000, 0);
    expect(cache.get("a", 999)).toEqual({ value: "1" });
    expect(cache.get("a", 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("stores null as a cached miss", () => {
    const cache = new TtlCache<string | null>();
    cache.set("a", null, 1000, 0);
    expect(cache.get("a", 1)).toEqual({ value: null });
    expect(cache.get("b", 1)).toBeUndefined();
  });

  it("drops the oldest entry when full", () => {
    const cache = new TtlCache<number>(2);
    cache.set("a", 1, 1000, 0);
    cache.set("b", 2, 1000, 0);
    cache.set("c", 3, 1000, 0);
    expect(cache.get("a", 1)).toBeUndefined();
    expect(cache.get("b", 1)).toEqual({ value: 2 });
    expect(cache.get("c", 1)).toEqual({ value: 3 });
  });
});
