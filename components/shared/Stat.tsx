import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * One cell of a stat grid (`<dl>` with 1 px gaps on a border-coloured
 * background). Used by the trader header and the account page.
 */

export function Stat({
  label,
  loading,
  children,
}: {
  label: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-background px-3 py-2.5">
      <dt className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-col gap-0.5">
        {loading ? (
          <>
            <Skeleton className="h-[22px] w-24 lg:h-[26px]" />
            <Skeleton className="h-3 w-16" />
          </>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}

export function StatValue({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("truncate font-mono text-lg text-foreground lg:text-xl", className)}>
      {children}
    </span>
  );
}

export function StatNote({ children }: { children: ReactNode }) {
  return <span className="truncate text-2xs text-faint">{children}</span>;
}

/** The grid around the cells: 2 columns on mobile, 4 from `lg` up. */
export const STAT_GRID =
  "grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4";
