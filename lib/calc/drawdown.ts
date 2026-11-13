import type { TimePoint } from "@/lib/hyperliquid/schemas";

import { type ChartPoint, toChartSeries } from "./pnlSeries";

/*
 * Drawdown from the PnL history. The account value history is not used for
 * the curve, because deposits and withdrawals change it without a trade.
 */

/**
 * The drawdown at each point: the value minus the highest value so far
 * (0 or below). Times are in seconds, sorted, one point per second.
 */
export function drawdownSeries(points: readonly TimePoint[]): ChartPoint[] {
  const series = toChartSeries(points);
  const result: ChartPoint[] = [];
  let peak = Number.NEGATIVE_INFINITY;
  for (const point of series) {
    peak = Math.max(peak, point.value);
    // `+ 0` turns -0 into 0, so a point at its peak shows 0.
    result.push({ time: point.time, value: point.value - peak + 0 });
  }
  return result;
}

export interface MaxDrawdown {
  /** The largest fall from a peak in USD (0 or below). */
  usd: number;
  /** usd / the account value at the time of that peak, or null when it is unknown. */
  ratio: number | null;
  /** The time of the lowest point of the fall, in seconds. */
  time: number;
}

/**
 * The largest fall from a peak of the PnL history. The ratio uses the
 * account value at the time of the peak (both histories share the same
 * times). Null when there are fewer than 2 points. A series that never
 * falls gives 0 at the time of the first point.
 */
export function maxDrawdown(
  pnlPoints: readonly TimePoint[],
  accountValuePoints: readonly TimePoint[],
): MaxDrawdown | null {
  const series = toChartSeries(pnlPoints);
  const first = series[0];
  if (!first || series.length < 2) return null;

  let peak = first;
  let worst = { usd: 0, time: first.time, peakTime: first.time };
  for (const point of series) {
    if (point.value > peak.value) peak = point;
    const usd = point.value - peak.value;
    if (usd < worst.usd) worst = { usd, time: point.time, peakTime: peak.time };
  }

  const accountValue = toChartSeries(accountValuePoints).find(
    (point) => point.time === worst.peakTime,
  )?.value;
  const ratio =
    accountValue !== undefined && accountValue > 0 ? worst.usd / accountValue + 0 : null;
  return { usd: worst.usd, ratio, time: worst.time };
}
