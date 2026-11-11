"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TIME_WINDOWS, type TimeWindow } from "@/lib/hyperliquid/schemas";

export const WINDOW_LABEL: Record<TimeWindow, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  allTime: "All",
};

function isTimeWindow(value: string): value is TimeWindow {
  return (TIME_WINDOWS as readonly string[]).includes(value);
}

/** A 28 px segmented control for the time window. */
export function WindowTabs({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (window: TimeWindow) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (isTimeWindow(next)) onChange(next);
      }}
    >
      <TabsList aria-label="Time window">
        {TIME_WINDOWS.map((option) => (
          <TabsTrigger key={option} value={option} className="px-2 text-2xs sm:px-2.5 sm:text-xs">
            {WINDOW_LABEL[option]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
