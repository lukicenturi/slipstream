"use client";

import { useEffect, useRef } from "react";

import { LiveFeed } from "@/components/feed/LiveFeed";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { Panel } from "@/components/shared/Panel";
import { SkeletonRows } from "@/components/shared/States";
import { useHomeView } from "@/hooks/useNavState";
import { cn } from "@/lib/utils";

/** The Tailwind `lg` breakpoint, where both panels show side by side. */
const DESKTOP_QUERY = "(min-width: 64rem)";

const GRID =
  "grid min-h-0 flex-1 grid-cols-1 gap-4 lg:h-[calc(100dvh-7.5rem)] lg:flex-none lg:grid-cols-12";
const LEADERBOARD_CELL = "flex min-h-0 lg:col-span-7";
// Below `lg` the feed fills the viewport minus the header (49 px), the page
// gutters (24 px) and the bottom bar, so its list scrolls inside the panel.
const FEED_CELL =
  "flex min-h-0 lg:col-span-5 max-lg:h-[calc(100dvh-49px-1.5rem-var(--bottom-nav-space))] max-lg:min-h-80";

/**
 * Desktop: two columns (leaderboard 7/12, feed 5/12); `?view` is ignored.
 * Mobile: one panel at a time, picked by `?view=live` in the URL (the
 * bottom tab bar sets it). Both panels stay mounted, so the feed keeps its
 * items and its subscriptions when the view changes. It reads the URL, so
 * the page wraps it in <Suspense fallback={<HomePanelsSkeleton />}>.
 */
export function HomePanels() {
  const view = useHomeView();
  const feedRef = useRef<HTMLDivElement>(null);

  // Desktop "Live" link: both panels already show, so bring the feed into
  // view and move focus to its title.
  useEffect(() => {
    if (view !== "live" || !window.matchMedia(DESKTOP_QUERY).matches) return;
    const cell = feedRef.current;
    if (!cell) return;
    cell.scrollIntoView({ block: "nearest" });
    cell.querySelector<HTMLElement>("#live-title")?.focus({ preventScroll: true });
  }, [view]);

  return (
    <div className={GRID} data-view={view}>
      <div
        data-testid="home-panel-leaderboard"
        className={cn(LEADERBOARD_CELL, hiddenOnMobile(view !== "leaderboard"))}
      >
        <LeaderboardTable className="w-full" />
      </div>
      <div
        ref={feedRef}
        data-testid="home-panel-live"
        className={cn(FEED_CELL, hiddenOnMobile(view !== "live"))}
      >
        <LiveFeed className="w-full" />
      </div>
    </div>
  );
}

function hiddenOnMobile(hidden: boolean): string | false {
  return hidden && "max-lg:hidden";
}

/**
 * The Suspense fallback of `HomePanels`: the same grid with the loading rows
 * of both panels. The view is not known yet, so mobile shows the leaderboard.
 */
export function HomePanelsSkeleton() {
  return (
    <div className={GRID}>
      <div className={LEADERBOARD_CELL}>
        <Panel title="Leaderboard" titleId="leaderboard-title-loading" className="w-full">
          <SkeletonRows rows={10} label="Loading the leaderboard" />
        </Panel>
      </div>
      <div className={cn(FEED_CELL, "max-lg:hidden")}>
        <Panel title="Live trades" titleId="live-title-loading" className="w-full">
          <SkeletonRows rows={8} rowClassName="h-10" label="Loading the live feed" />
        </Panel>
      </div>
    </div>
  );
}
