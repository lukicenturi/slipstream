import { Suspense } from "react";

import { HomePanels, HomePanelsSkeleton } from "@/components/home/HomePanels";
import { WatchingStrip } from "@/components/home/WatchingStrip";
import { NamesProvider } from "@/components/providers/NamesProvider";
import { NETWORK } from "@/lib/network";

/** Home: the watchlist strip, the leaderboard and the live feed. */
export default function Home() {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col px-4 py-3 lg:px-6 lg:py-4">
      <h1 className="sr-only">
        {NETWORK === "testnet"
          ? "Slipstream testnet: top Hyperliquid testnet traders and their live trades"
          : "Slipstream: top Hyperliquid traders and their live trades"}
      </h1>
      {/*
        HomePanels reads `?view`, so it needs a Suspense boundary (cacheComponents).
        The boundary also holds NamesProvider: every user of the leaderboard query
        then hydrates together. Outside it, NamesProvider could fetch the
        leaderboard before the panels hydrate, and the HTML would not match.
      */}
      <Suspense fallback={<HomePanelsSkeleton />}>
        <NamesProvider>
          <WatchingStrip />
          <HomePanels />
        </NamesProvider>
      </Suspense>
    </div>
  );
}
