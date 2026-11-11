import * as React from "react";
import { cn } from "cn";

// Restyled for Slipstream: 32 px high, 4 px radius, 1 px border, 13 px text,
// accent border and a 1 px accent outline (2 px offset) on focus, no glow.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground transition-colors placeholder:text-faint hover:border-border-strong focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
