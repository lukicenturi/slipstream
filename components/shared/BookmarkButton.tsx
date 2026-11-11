"use client";

import { StarIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { toggleWatched, useIsWatched } from "@/hooks/useWatchlist";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A 28 px star (24 px with `size="icon-xs"`, next to the feed's Copy button) that adds a trader to the watchlist or removes it. It shares
 * the store with the profile's Follow button. The click does not reach the
 * row, so it never follows the row link.
 */
export function BookmarkButton({
  address,
  size = "icon-sm",
  className,
}: {
  address: string;
  size?: "icon-sm" | "icon-xs";
  className?: string;
}) {
  const tracked = useIsWatched(address);
  const label = `${tracked ? "Stop tracking" : "Track"} ${shortAddress(address.toLowerCase())}`;

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    toggleWatched(address);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      aria-pressed={tracked}
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid="bookmark-button"
      data-tracked={tracked ? "true" : "false"}
      className={cn(tracked ? "text-brand hover:text-brand" : "text-faint", className)}
    >
      <StarIcon
        aria-hidden="true"
        className={cn(size === "icon-xs" ? "size-3" : "size-3.5", tracked && "fill-current")}
      />
    </Button>
  );
}
