import { AlertTriangleIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Placeholder rows while data loads. */
export function SkeletonRows({
  rows,
  rowClassName,
  label = "Loading",
}: {
  rows: number;
  rowClassName?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cn("flex h-9 items-center gap-3 border-b px-3", rowClassName)}>
          <Skeleton className="h-3 w-5" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="ml-auto h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/** A quiet message for a view with no data. */
export function EmptyState({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5 px-4 py-10 text-center", className)}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  );
}

/** A failure message with an optional retry button. */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = "Retry",
  className,
}: {
  title: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}
    >
      <AlertTriangleIcon className="size-4 text-short" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
