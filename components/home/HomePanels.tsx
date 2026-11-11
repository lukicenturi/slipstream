"use client";

import { LiveFeed } from "@/components/feed/LiveFeed";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { Panel } from "@/components/shared/Panel";
import { SkeletonRows } from "@/components/shared/States";
import { useHomeView } from "@/hooks/useNavState";
import { cn } from "@/lib/utils";

const GRID =
  "grid min-h-0 flex-1 grid-cols-1 gap-4 lg:h-[calc(100dvh-7.5rem)] lg:flex-none lg:grid-cols-12";
const LEADERBOARD_CELL = "flex min-h-0 lg:col-span-7";
// Below `lg` the feed fills the viewport minus the header (49 px), the page
// gutters (24 px) and the bottom bar, so its list scrolls inside the panel.
const FEED_CELL =
  "flex min-h-0 max-lg:h-[calc(100dvh-49px-1.5rem-var(--bottom-nav-space))] max-lg:min-h-80";

/**
 * `/`: the leaderboard (7/12) and the feed (5/12) on desktop; only the
 * leaderboard on mobile.
 * `/?view=live`: only the feed at every width. On desktop the feed spans
 * all 12 columns and shows a dense table.
 * Both panels stay mounted, so the feed keeps its items and its
 * subscriptions when the view changes. It reads the URL, so the page wraps
 * it in <Suspense fallback={<HomePanelsSkeleton />}>.
 */
export function HomePanels() {
  const view = useHomeView();
  const live = view === "live";

  return (
    <div className={GRID} data-view={view}>
      <div
        data-testid="home-panel-leaderboard"
        // Hidden, not unmounted: the leaderboard query and its rows stay ready.
        className={cn(LEADERBOARD_CELL, live ? "hidden" : null)}
      >
        <LeaderboardTable className="w-full" />
      </div>
      <div
        data-testid="home-panel-live"
        className={cn(FEED_CELL, live ? "lg:col-span-12" : "max-lg:hidden lg:col-span-5")}
      >
        <LiveFeed className="w-full" layout={live ? "wide" : "panel"} />
      </div>
    </div>
  );
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
      <div className={cn(FEED_CELL, "max-lg:hidden lg:col-span-5")}>
        <Panel title="Live trades" titleId="live-title-loading" className="w-full">
          <SkeletonRows rows={8} rowClassName="h-10" label="Loading the live feed" />
        </Panel>
      </div>
    </div>
  );
}
