import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const STEPS = ["Wallet", "Agent", "Order"] as const;

/**
 * The 3 steps of a copy trade in a trading build. A done step shows a check icon, the
 * current step has aria-current and an accent underline, and a later step
 * is faint. Colour is never the only signal.
 */
export function TradingSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Trading steps" data-testid="trading-steps" className="grid grid-cols-3 gap-1">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            data-state={done ? "done" : active ? "current" : "todo"}
            className={cn(
              "flex h-7 items-center gap-1.5 border-b px-1 text-xs",
              done && "text-muted-foreground",
              active && "border-brand font-medium text-foreground",
              !done && !active && "text-faint",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-4 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] leading-none",
                active && "border-brand text-brand",
                done && "border-long/60 text-long",
              )}
            >
              {done ? <CheckIcon className="size-2.5" /> : step}
            </span>
            {label}
            {done ? <span className="sr-only"> (done)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
