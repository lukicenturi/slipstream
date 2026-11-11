import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A bordered panel with a 40 px header row. The body scrolls on desktop. */
export function Panel({
  title,
  titleId,
  meta,
  actions,
  children,
  className,
}: {
  title: string;
  titleId: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background",
        className,
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h2 id={titleId} className="text-sm font-semibold text-foreground max-lg:sr-only">
          {title}
        </h2>
        {meta ? <div className="min-w-0 truncate text-2xs text-faint">{meta}</div> : null}
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
