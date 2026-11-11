"use client";

import Link from "next/link";

import { Blockie } from "@/components/shared/Blockie";
import { useDisplayName } from "@/hooks/useNames";
import { useWatchlist } from "@/hooks/useWatchlist";
import { cn } from "@/lib/utils";

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
          <WatchingChip key={address} address={address} />
        ))}
      </ul>
      <Link
        href="/watchlist"
        prefetch={false}
        className="ml-auto shrink-0 rounded-sm text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Manage
      </Link>
    </nav>
  );
}

/** One followed trader. It shows a name when the home page lookup found one. */
function WatchingChip({ address }: { address: string }) {
  const name = useDisplayName(address);
  return (
    <li className="shrink-0">
      <Link
        href={`/trader/${address}`}
        prefetch={false}
        title={address}
        className={cn(
          "inline-flex h-6 max-w-[10rem] items-center gap-1.5 rounded-sm border pr-2 pl-1 text-2xs text-foreground transition-colors hover:border-border-strong hover:text-brand",
          name.source === "address" ? "font-mono" : "font-medium",
        )}
      >
        <Blockie address={address} />
        <span className="min-w-0 truncate">{name.label}</span>
      </Link>
    </li>
  );
}
