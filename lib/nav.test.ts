import { describe, expect, it } from "vitest";

import { activeNavKey, NAV_ITEMS, navCountBadge, parseHomeView } from "./nav";

describe("NAV_ITEMS", () => {
  it("lists the three destinations in order", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(["/", "/?view=live", "/watchlist"]);
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
  it("marks the watchlist on /watchlist at every width", () => {
    expect(activeNavKey("/watchlist", null, false)).toBe("watchlist");
    expect(activeNavKey("/watchlist", "live", true)).toBe("watchlist");
  });

  it("marks live on /?view=live on mobile", () => {
    expect(activeNavKey("/", "live", false)).toBe("live");
  });

  it("marks the leaderboard on / on mobile without the live view", () => {
    expect(activeNavKey("/", null, false)).toBe("leaderboard");
    expect(activeNavKey("/", "other", false)).toBe("leaderboard");
  });

  it("always marks the leaderboard on / on desktop", () => {
    expect(activeNavKey("/", null, true)).toBe("leaderboard");
    expect(activeNavKey("/", "live", true)).toBe("leaderboard");
  });

  it("marks nothing on other routes", () => {
    expect(activeNavKey("/trader/0xf5d81a135f756ca16544e53c20fc20643ec3ad53", null, false)).toBe(
      null,
    );
    expect(activeNavKey("/dev", "live", true)).toBe(null);
    expect(activeNavKey("/watchlist/extra", null, false)).toBe(null);
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
