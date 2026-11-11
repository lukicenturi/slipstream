"use client";

// Restyled for Slipstream: thin 4 px track, accent range, outlined thumb,
// 1 px accent outline on focus. `thumbLabel` and `valueText` go on the
// thumb (the element with role="slider"), so screen readers announce them.

import * as React from "react";
import { cn } from "cn";
import { Slider as SliderPrimitive } from "radix-ui";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabel,
  valueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** aria-label of the thumb. */
  thumbLabel?: string;
  /** aria-valuetext of the thumb, for example "5x" instead of "5". */
  valueText?: (value: number) => string;
}) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-sm bg-border-strong data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-primary select-none data-horizontal:h-full data-vertical:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={thumbLabel}
          aria-valuetext={valueText?.(_values[index])}
          className="relative block size-3.5 shrink-0 rounded-full border border-primary bg-background transition-colors select-none after:absolute after:-inset-2 hover:bg-surface-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
