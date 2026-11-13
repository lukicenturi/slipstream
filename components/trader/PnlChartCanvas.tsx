"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

import type { ChartPoint } from "@/lib/calc/pnlSeries";
import { formatUsd } from "@/lib/format";

/*
 * The canvas part of the PnL chart. It runs only in the browser
 * (PnlChart loads it with next/dynamic and ssr: false). The PnL line is in
 * the first pane. The drawdown is an area in a second, lower pane.
 */

/** The index of the drawdown pane. */
const DRAWDOWN_PANE = 1;

interface ChartTokens {
  text: string;
  border: string;
  borderStrong: string;
  surfaceHover: string;
  long: string;
  longDim: string;
  short: string;
  shortDim: string;
  mono: string;
}

/** The canvas cannot read CSS variables, so read the token values once. */
function readTokens(): ChartTokens {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    text: token("--ss-text-muted", "#8b919a"),
    border: token("--ss-border", "#22262d"),
    borderStrong: token("--ss-border-strong", "#2e333b"),
    surfaceHover: token("--ss-surface-hover", "#171a1f"),
    long: token("--ss-long", "#2fbf71"),
    longDim: token("--ss-long-dim", "rgba(47,191,113,0.12)"),
    short: token("--ss-short", "#e5484d"),
    shortDim: token("--ss-short-dim", "rgba(229,72,77,0.12)"),
    mono: `${token("--font-geist-mono", "ui-monospace")}, ui-monospace, monospace`,
  };
}

export function PnlChartCanvas({
  data,
  drawdown,
  height = 276,
  drawdownHeight = 56,
}: {
  data: readonly ChartPoint[];
  /** The drawdown from the running peak at each point (0 or below). */
  drawdown: readonly ChartPoint[];
  /** The full canvas height, both panes. */
  height?: number;
  /** The height of the drawdown pane. */
  drawdownHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const drawdownRef = useRef<ISeriesApi<"Area"> | null>(null);

  // Create the chart once and resize it with the container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const tokens = readTokens();
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: tokens.text,
        fontFamily: tokens.mono,
        fontSize: 11,
        // The TradingView link that the licence asks for is under the chart.
        attributionLogo: false,
        panes: {
          separatorColor: tokens.border,
          separatorHoverColor: tokens.border,
          enableResize: false,
        },
      },
      grid: {
        vertLines: { color: tokens.border },
        horzLines: { color: tokens.border },
      },
      rightPriceScale: { borderColor: tokens.border },
      timeScale: { borderColor: tokens.border, timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: tokens.borderStrong, labelBackgroundColor: tokens.surfaceHover },
        horzLine: { color: tokens.borderStrong, labelBackgroundColor: tokens.surfaceHover },
      },
      localization: { priceFormatter: (price: number) => formatUsd(price, { compact: true }) },
      handleScroll: false,
      handleScale: false,
    });
    seriesRef.current = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    drawdownRef.current = chart.addSeries(
      AreaSeries,
      {
        lineWidth: 1,
        lineColor: tokens.short,
        // The same colour at the top and the bottom: a flat fill, no gradient.
        topColor: tokens.shortDim,
        bottomColor: tokens.shortDim,
        // Fill from the line up to 0, so the area shows the depth of each fall.
        invertFilledArea: true,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      DRAWDOWN_PANE,
    );
    chart.panes()[DRAWDOWN_PANE]?.setHeight(drawdownHeight);
    chartRef.current = chart;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.resize(Math.floor(width), height);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      drawdownRef.current = null;
    };
  }, [height, drawdownHeight]);

  // Set the data and colour the line by the sign of the last value.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const tokens = readTokens();
    const positive = (data[data.length - 1]?.value ?? 0) >= 0;
    // The same colour at the top and the bottom: a flat fill, no gradient.
    const fill = positive ? tokens.longDim : tokens.shortDim;
    series.applyOptions({
      lineColor: positive ? tokens.long : tokens.short,
      topColor: fill,
      bottomColor: fill,
    });
    series.setData(data.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    drawdownRef.current?.setData(
      drawdown.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
    );
    chart.timeScale().fitContent();
  }, [data, drawdown]);

  return <div ref={containerRef} data-testid="pnl-chart" className="w-full" style={{ height }} />;
}
