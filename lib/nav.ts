/*
 * The primary navigation model. Pure data and helpers, so that the header
 * nav and the mobile bottom bar agree on the destinations and the active item.
 */

export const NAV_ITEMS = [
  { key: "leaderboard", label: "Leaderboard", href: "/", icon: "trophy" },
  { key: "live", label: "Live", href: "/?view=live", icon: "activity" },
  { key: "watchlist", label: "Watchlist", href: "/watchlist", icon: "bookmark" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
export type NavKey = NavItem["key"];
export type NavIcon = NavItem["icon"];

export type HomeView = "leaderboard" | "live";

/** The mobile view of the home page. Only the exact string "live" selects the feed. */
export function parseHomeView(view: string | null): HomeView {
  return view === "live" ? "live" : "leaderboard";
}

/**
 * The active nav item for a URL. On desktop the home page shows both panels,
 * so `/` is always "leaderboard" there. Other routes (a profile, /dev) have
 * no active item.
 */
export function activeNavKey(
  pathname: string,
  view: string | null,
  isDesktop: boolean,
): NavKey | null {
  if (pathname === "/watchlist") return "watchlist";
  if (pathname === "/") {
    return !isDesktop && parseHomeView(view) === "live" ? "live" : "leaderboard";
  }
  return null;
}

/** The text of the watchlist count badge in the bottom bar, or null for no badge. */
export function navCountBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}
