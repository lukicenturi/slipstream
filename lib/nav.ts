/*
 * The primary navigation model. Pure data and helpers, so that the header
 * nav and the mobile bottom bar agree on the destinations and the active item.
 */

export const NAV_ITEMS = [
  { key: "leaderboard", label: "Leaderboard", href: "/", icon: "trophy" },
  { key: "live", label: "Live", href: "/?view=live", icon: "activity" },
  { key: "watchlist", label: "Watchlist", href: "/watchlist", icon: "bookmark" },
  { key: "account", label: "Account", href: "/account", icon: "user" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
export type NavKey = NavItem["key"];
export type NavIcon = NavItem["icon"];

export type HomeView = "leaderboard" | "live";

/**
 * The view of the home page. Only the exact string "live" selects the feed:
 * on mobile it shows only the feed, on desktop the full-width feed table.
 */
export function parseHomeView(view: string | null): HomeView {
  return view === "live" ? "live" : "leaderboard";
}

/**
 * The active nav item for a URL. The result is the same at every width:
 * `/?view=live` is "live" on mobile (feed only) and on desktop (full-width
 * feed). Other routes (a profile, /dev) have no active item.
 */
export function activeNavKey(pathname: string, view: string | null): NavKey | null {
  if (pathname === "/watchlist") return "watchlist";
  if (pathname === "/account") return "account";
  if (pathname === "/") return parseHomeView(view) === "live" ? "live" : "leaderboard";
  return null;
}

/** The text of the watchlist count badge in the bottom bar, or null for no badge. */
export function navCountBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}
