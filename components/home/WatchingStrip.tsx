"use client";

import Link from "next/link";

import { useWatchlist } from "@/hooks/useWatchlist";
import { shortAddress } from "@/lib/format";

/** The followed traders as chips. Renders nothing while the watchlist is empty. */
export function WatchingStrip() {
  const { addresses } = useWatchlist();
  if (addresses.length === 0) return null;
  return (
    <nav
      aria-label="Watching"
      data-testid="watching-strip"
      className="mb-3 flex min-w-0 items-center gap-2"
    >
      <span className="shrink-0 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        Watching
      </span>
      <ul className="flex min-w-0 gap-1.5 overflow-x-auto">
        {addresses.map((address) => (
          <li key={address} className="shrink-0">
            <Link
              href={`/trader/${address}`}
              prefetch={false}
              title={address}
              className="inline-flex h-6 items-center rounded-sm border px-2 font-mono text-2xs text-foreground transition-colors hover:border-border-strong hover:text-brand"
            >
              {shortAddress(address)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
