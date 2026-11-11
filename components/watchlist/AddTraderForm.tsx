"use client";

import { AddressNameForm, type ResolvedInput } from "@/components/shared/AddressNameForm";
import { useWatchlist } from "@/hooks/useWatchlist";

/**
 * Add a trader by address, `.eth` name or `.hl` name. Names resolve on our
 * server (/api/resolve). On success the input clears.
 */
export function AddTraderForm({ className }: { className?: string }) {
  const { add, isFollowing } = useWatchlist();

  function track({ address, label }: ResolvedInput): string {
    if (isFollowing(address)) return `Already tracking ${label}.`;
    add(address);
    return `Tracking ${label}.`;
  }

  return (
    <AddressNameForm
      onResolved={track}
      inputLabel="Trader address or name to track"
      submitLabel="Track"
      className={className}
      formTestId="watchlist-add-form"
      submitTestId="watchlist-add"
    />
  );
}
