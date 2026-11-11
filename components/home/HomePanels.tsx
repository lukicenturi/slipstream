"use client";

import { useState } from "react";

import { LiveFeed } from "@/components/feed/LiveFeed";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type HomeTab = "leaderboard" | "live";

/**
 * Desktop: two columns (leaderboard 7/12, feed 5/12).
 * Mobile: tabs. Both panels stay mounted (forceMount), so the feed keeps
 * its items and its subscriptions when the tab changes.
 */
export function HomePanels() {
  const [tab, setTab] = useState<HomeTab>("leaderboard");

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value === "live" ? "live" : "leaderboard")}
      className="min-h-0 flex-1 gap-3"
    >
      <TabsList variant="line" className="w-full justify-start lg:hidden">
        <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
        <TabsTrigger value="live">Live</TabsTrigger>
      </TabsList>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:h-[calc(100dvh-7.5rem)] lg:flex-none lg:grid-cols-12">
        <TabsContent
          value="leaderboard"
          forceMount
          className="min-h-0 data-[state=inactive]:hidden lg:col-span-7 lg:flex lg:data-[state=inactive]:flex"
        >
          <LeaderboardTable className="w-full" />
        </TabsContent>
        <TabsContent
          value="live"
          forceMount
          className="min-h-0 data-[state=inactive]:hidden lg:col-span-5 lg:flex lg:data-[state=inactive]:flex"
        >
          <LiveFeed className="w-full" />
        </TabsContent>
      </div>
    </Tabs>
  );
}
