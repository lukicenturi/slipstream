"use client";

import { useState } from "react";

import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Flash {
  direction: "up" | "down";
  /** Changes on every flash, so the element remounts and the animation runs again. */
  key: number;
}

/**
 * The last change of a value: up or down. The previous value lives in
 * state and updates during render (the React pattern for derived state),
 * so no effect runs on each tick.
 */
function useFlash(value: number | undefined): Flash | null {
  const [state, setState] = useState<{ previous: number | undefined; flash: Flash | null }>({
    previous: value,
    flash: null,
  });
  if (Object.is(value, state.previous)) return state.flash;

  let flash = state.flash;
  if (state.previous !== undefined && value !== undefined) {
    flash = { direction: value > state.previous ? "up" : "down", key: (flash?.key ?? 0) + 1 };
  }
  setState({ previous: value, flash });
  return flash;
}

/**
 * A live price. The background flashes green when the value goes up and
 * red when it goes down (motion-safe only). Tabular mono digits, so the
 * width does not jump.
 */
export function Price({
  value,
  format = formatPrice,
  className,
}: {
  value: number | undefined;
  format?: (value: number) => string;
  className?: string;
}) {
  const flash = useFlash(value);
  return (
    <span
      key={flash?.key ?? 0}
      data-flash={flash?.direction}
      className={cn(
        "rounded-sm px-1 font-mono",
        flash?.direction === "up" && "motion-safe:animate-flash-up",
        flash?.direction === "down" && "motion-safe:animate-flash-down",
        className,
      )}
    >
      {value === undefined ? "—" : format(value)}
    </span>
  );
}
