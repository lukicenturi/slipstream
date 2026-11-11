import type { Metadata } from "next";

import { WatchlistView } from "@/components/watchlist/WatchlistView";

export const metadata: Metadata = {
  title: "Watchlist · Slipstream",
};

/** The watchlist. A thin server page around the client view (the list lives in localStorage). */
export default function WatchlistPage() {
  return <WatchlistView />;
}
