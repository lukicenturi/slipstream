import { HomePanels } from "@/components/home/HomePanels";
import { WatchingStrip } from "@/components/home/WatchingStrip";

/** Home: the watchlist strip, the leaderboard and the live feed. */
export default function Home() {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col px-4 py-3 lg:px-6 lg:py-4">
      <h1 className="sr-only">Slipstream: top Hyperliquid traders and their live trades</h1>
      <WatchingStrip />
      <HomePanels />
    </div>
  );
}
