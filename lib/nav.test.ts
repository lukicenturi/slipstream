import { describe, expect, it } from "vitest";

import { activeNavKey, NAV_ITEMS, navCountBadge, parseHomeView } from "./nav";

describe("NAV_ITEMS", () => {
  it("lists the four destinations in order", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      "/",
      "/?view=live",
      "/watchlist",
      "/account",
    ]);
  });

  it("labels the account item and gives it the user icon", () => {
    const account = NAV_ITEMS.find((item) => item.key === "account");
    expect(account?.label).toBe("Account");
    expect(account?.icon).toBe("user");
  });
});

describe("parseHomeView", () => {
  it("returns live only for the exact string", () => {
    expect(parseHomeView("live")).toBe("live");
  });

  it("returns leaderboard for a missing or other value", () => {
    expect(parseHomeView(null)).toBe("leaderboard");
    expect(parseHomeView("")).toBe("leaderboard");
    expect(parseHomeView("Live")).toBe("leaderboard");
    expect(parseHomeView("live ")).toBe("leaderboard");
    expect(parseHomeView("leaderboard")).toBe("leaderboard");
  });
});

describe("activeNavKey", () => {
  it("marks the watchlist on /watchlist", () => {
    expect(activeNavKey("/watchlist", null)).toBe("watchlist");
    expect(activeNavKey("/watchlist", "live")).toBe("watchlist");
  });

  it("marks the account on /account", () => {
    expect(activeNavKey("/account", null)).toBe("account");
    expect(activeNavKey("/account", "live")).toBe("account");
  });

  it("marks live on /?view=live (the same at every width)", () => {
    expect(activeNavKey("/", "live")).toBe("live");
  });

  it("marks the leaderboard on / without the live view", () => {
    expect(activeNavKey("/", null)).toBe("leaderboard");
    expect(activeNavKey("/", "other")).toBe("leaderboard");
  });

  it("marks nothing on other routes", () => {
    expect(activeNavKey("/trader/0xf5d81a135f756ca16544e53c20fc20643ec3ad53", null)).toBe(null);
    expect(activeNavKey("/dev", "live")).toBe(null);
    expect(activeNavKey("/watchlist/extra", null)).toBe(null);
    expect(activeNavKey("/account/extra", null)).toBe(null);
  });
});

describe("navCountBadge", () => {
  it("returns null for no tracked traders", () => {
    expect(navCountBadge(0)).toBe(null);
    expect(navCountBadge(-1)).toBe(null);
    expect(navCountBadge(Number.NaN)).toBe(null);
  });

  it("returns the count up to 99, then 99+", () => {
    expect(navCountBadge(1)).toBe("1");
    expect(navCountBadge(99)).toBe("99");
    expect(navCountBadge(100)).toBe("99+");
  });
});
