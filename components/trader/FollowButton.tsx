"use client";

import { CheckIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/hooks/useWatchlist";
import { cn } from "@/lib/utils";

/** Add or remove a trader from the watchlist. All buttons share one store. */
export function FollowButton({ address, className }: { address: string; className?: string }) {
  const { isFollowing, toggle } = useWatchlist();
  const following = isFollowing(address);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={following}
      onClick={() => toggle(address)}
      data-testid="follow-button"
      className={cn(
        "w-[6.5rem]",
        following &&
          "border-brand/40 bg-brand-dim text-brand hover:border-brand/60 hover:bg-brand-dim",
        className,
      )}
    >
      {following ? <CheckIcon aria-hidden="true" /> : <PlusIcon aria-hidden="true" />}
      {following ? "Following" : "Follow"}
    </Button>
  );
}
