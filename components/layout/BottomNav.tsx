"use client";

import Link from "next/link";

import { useWatchlist } from "@/hooks/useWatchlist";
import { useActiveNavKey } from "@/hooks/useNavState";
import { NAV_ITEMS, navCountBadge, type NavKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

import { NAV_ICONS } from "./navIcons";

/**
 * The mobile tab bar (below `lg`). It is fixed to the bottom: 56 px plus
 * the safe-area inset. The body reserves the same space with
 * `--bottom-nav-space`, so no content hides behind it. It reads the URL,
 * so the parent must wrap it in <Suspense fallback={<BottomNavLinks active={null} />}>.
 */
export function BottomNav() {
  const active = useActiveNavKey(false);
  return <BottomNavLinks active={active} />;
}

/** The tabs themselves. With `active={null}` it is the Suspense fallback. */
export function BottomNavLinks({ active }: { active: NavKey | null }) {
  const { addresses } = useWatchlist();
  const badge = navCountBadge(addresses.length);
  return (
    <nav
      aria-label="Primary"
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {/* 55 px + the 1 px top border = 56 px, the height that --bottom-nav-space reserves. */}
      <div className="mx-auto flex h-[calc(3.5rem-1px)] w-full max-w-lg">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          const Icon = NAV_ICONS[item.icon];
          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch={item.key === "live" ? false : undefined}
              aria-current={isActive ? "page" : undefined}
              data-testid={`bottom-nav-${item.key}`}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-sm text-2xs transition-colors focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                isActive ? "font-medium text-brand" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="relative">
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-[18px]",
                    isActive && item.icon === "bookmark" && "fill-current",
                  )}
                />
                {item.key === "watchlist" && badge ? (
                  <span
                    aria-hidden="true"
                    data-testid="bottom-nav-watchlist-badge"
                    className="absolute -top-1.5 left-3 flex h-3.5 min-w-3.5 items-center justify-center rounded-sm bg-brand px-0.5 font-mono text-[10px] leading-none text-primary-foreground tabular-nums"
                  >
                    {badge}
                  </span>
                ) : null}
              </span>
              <span>{item.label}</span>
              {item.key === "watchlist" && addresses.length > 0 ? (
                <span className="sr-only">, {addresses.length} tracked</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
