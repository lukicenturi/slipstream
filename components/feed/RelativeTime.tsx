"use client";

import { useNow } from "@/hooks/useNow";
import { formatRelativeTime } from "@/lib/format";

/** "12s ago", refreshed by the shared 10 s clock. */
export function RelativeTime({ time, className }: { time: number; className?: string }) {
  const now = useNow();
  return (
    <time dateTime={new Date(time).toISOString()} className={className}>
      {formatRelativeTime(time, Math.max(now, time))}
    </time>
  );
}
