"use client";

import Link from "next/link";

import { useWatchlist } from "@/hooks/useWatchlist";
import { useActiveNavKey } from "@/hooks/useNavState";
import { NAV_ITEMS, type NavKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * The desktop nav links (from `lg` up). It reads the URL, so the parent
 * must wrap it in <Suspense fallback={<HeaderNavLinks active={null} />}>.
 * `/` marks "Leaderboard" (both panels); `/?view=live` marks "Live"
 * (the full-width feed).
 */
export function HeaderNav() {
  const active = useActiveNavKey();
  return <HeaderNavLinks active={active} />;
}

/** The links themselves. With `active={null}` it is the Suspense fallback. */
export function HeaderNavLinks({ active }: { active: NavKey | null }) {
  const { addresses } = useWatchlist();
  const count = addresses.length;
  return (
    <nav
      aria-label="Primary"
      data-testid="header-nav"
      className="hidden shrink-0 items-center gap-1 lg:flex"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            prefetch={item.key === "live" ? false : undefined}
            aria-current={isActive ? "page" : undefined}
            data-testid={`header-nav-${item.key}`}
            className={cn(
              "relative inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
              // The active bar is 2 px high and covers the header's bottom border:
              // the link ends 8 px above the content edge, plus 1 px of border.
              isActive
                ? "text-foreground after:absolute after:inset-x-2 after:-bottom-[9px] after:h-0.5 after:bg-brand"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.key === "watchlist" && count > 0 ? (
              <span
                data-testid="header-nav-watchlist-count"
                className="font-mono text-2xs text-faint tabular-nums"
              >
                {count}
                <span className="sr-only"> tracked</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
