import type { TimePoint } from "@/lib/hyperliquid/schemas";

/*
 * Chart data for the PnL chart. lightweight-charts needs times in seconds
 * that strictly increase, so this sorts the points and keeps one point
 * per second.
 */

export interface ChartPoint {
  /** Unix time in seconds. */
  time: number;
  value: number;
}

/**
 * Convert ms points to seconds, sort them by time and keep the last value
 * for each second. Points with a time or value that is not finite are dropped.
 */
export function toChartSeries(points: readonly TimePoint[]): ChartPoint[] {
  const sorted = points
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .map((point, index) => ({ time: Math.floor(point.time / 1000), value: point.value, index }))
    // A stable order: equal seconds keep their input order, so "last" is the later point.
    .sort((a, b) => a.time - b.time || a.index - b.index);

  const series: ChartPoint[] = [];
  for (const point of sorted) {
    const previous = series[series.length - 1];
    if (previous && previous.time === point.time) previous.value = point.value;
    else series.push({ time: point.time, value: point.value });
  }
  return series;
}
