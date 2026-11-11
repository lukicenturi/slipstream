import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A bordered panel with a 40 px header row. The body scrolls on desktop.
 * By default the title is visually hidden below `lg`, because the mobile
 * bottom tab bar shows the same words. Set `titleOnMobile` to show it.
 * Set `focusableBody` when the body can scroll but holds no focusable
 * element, so keyboard users can still scroll it. Set `focusableTitle` so
 * that a script can move focus to the title (tab index -1).
 */
export function Panel({
  title,
  titleId,
  meta,
  actions,
  children,
  className,
  titleOnMobile = false,
  focusableBody = false,
  focusableTitle = false,
}: {
  title: string;
  titleId: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  titleOnMobile?: boolean;
  focusableBody?: boolean;
  focusableTitle?: boolean;
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
        <h2
          id={titleId}
          tabIndex={focusableTitle ? -1 : undefined}
          className={cn(
            "text-sm font-semibold text-foreground",
            !titleOnMobile && "max-lg:sr-only",
            focusableTitle &&
              "rounded-sm focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          {title}
        </h2>
        {meta ? <div className="min-w-0 truncate text-2xs text-faint">{meta}</div> : null}
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto focus-visible:-outline-offset-1"
        tabIndex={focusableBody ? 0 : undefined}
      >
        {children}
      </div>
    </section>
  );
}
