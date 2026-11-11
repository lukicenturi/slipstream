"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AssetIcon } from "@/components/shared/AssetIcon";
import { Price } from "@/components/shared/Price";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import {
  SIZE_MAX_USD,
  SIZE_MIN_USD,
  SIZE_STEP_USD,
  clampSizeUsd,
  parseSizeInput,
} from "@/lib/calc/copyTrade";
import { estimateLiquidation, estimateMargin, positionSizeInCoin } from "@/lib/calc/liquidation";
import { displaySymbol } from "@/lib/assets";
import { EMPTY_VALUE, formatPercent, formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { PositionSide } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

/*
 * The parts that the demo sheet and the trading sheet share: the header,
 * the asset and side row, the size and leverage fields, and the summary.
 * They are presentational. Each form owns its state.
 */

export const LABEL = "text-2xs font-medium tracking-wide text-muted-foreground uppercase";

const sizeInputFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "$1,250" or "$1,250.5": no forced cents, unlike formatUsd below 1,000. */
export function formatSizeUsd(value: number): string {
  return `$${sizeInputFormat.format(value)}`;
}

export function CopyTradeHeader({ badge }: { badge: ReactNode }) {
  return (
    <SheetHeader className="h-[52px] flex-row items-center gap-2 border-b px-4 py-0 pr-12">
      <SheetTitle>Copy trade</SheetTitle>
      {badge}
    </SheetHeader>
  );
}

export function AssetRow({
  coin,
  sideName,
  side,
  onSideChange,
}: {
  coin: string;
  sideName: string;
  side: PositionSide;
  onSideChange: (side: PositionSide) => void;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className={LABEL}>Asset</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-lg font-semibold text-foreground">
          <AssetIcon coin={coin} size={24} />
          <span className="truncate">{displaySymbol(coin)}</span>
          <span className="text-2xs font-normal text-faint">Perp</span>
        </p>
      </div>
      <SideToggle name={sideName} value={side} onChange={onSideChange} />
    </div>
  );
}

/**
 * The USD size input and slider. The typed text stays a draft until it is
 * valid. The demo uses the default range; the trading sheet passes its own
 * range (the $10 minimum up to the per-order cap) and a cap line as `children`.
 */
export function SizeField({
  id,
  value,
  onChange,
  min = SIZE_MIN_USD,
  max = SIZE_MAX_USD,
  step = SIZE_STEP_USD,
  children,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Extra content under the range line (the trading sheet's cap). */
  children?: ReactNode;
}) {
  // The raw text while the user types; null shows the formatted size.
  const [draft, setDraft] = useState<string | null>(null);
  const isDefaultRange = min === SIZE_MIN_USD && max === SIZE_MAX_USD;

  function clamp(next: number): number {
    if (isDefaultRange) return clampSizeUsd(next);
    if (!Number.isFinite(next)) return max;
    return Math.min(max, Math.max(min, next));
  }

  function onText(text: string) {
    setDraft(text);
    const parsed = parseSizeInput(text);
    if (parsed !== null && parsed >= min && parsed <= max) onChange(parsed);
  }

  function commit() {
    if (draft === null) return;
    const parsed = parseSizeInput(draft);
    if (parsed !== null) onChange(clamp(parsed));
    setDraft(null);
  }

  return (
    <div className="rounded-md border bg-surface px-3 pt-2.5 pb-3">
      <div className="flex items-baseline justify-between">
        <label htmlFor={`${id}-size`} className={LABEL}>
          Size
        </label>
        <span className="text-2xs text-faint">USD</span>
      </div>
      <div className="mt-1 flex items-baseline gap-0.5">
        <span aria-hidden="true" className="font-mono text-hero text-muted-foreground">
          $
        </span>
        <input
          id={`${id}-size`}
          data-testid="copy-size-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={draft ?? sizeInputFormat.format(value)}
          onChange={(event) => onText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          aria-describedby={`${id}-size-range`}
          className="w-full min-w-0 rounded-sm bg-transparent font-mono text-hero text-foreground"
        />
      </div>
      <Slider
        className="mt-3"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => {
          if (next === undefined) return;
          onChange(next);
          setDraft(null);
        }}
        thumbLabel="Size in USD"
        valueText={formatSizeUsd}
      />
      <p
        id={`${id}-size-range`}
        className="mt-2 flex justify-between font-mono text-2xs text-faint"
      >
        <span>{formatSizeUsd(min)}</span>
        <span className="sr-only"> to </span>
        <span data-testid="copy-size-max">{formatSizeUsd(max)}</span>
      </p>
      {children}
    </div>
  );
}

export function LeverageField({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-md border bg-surface px-3 pt-2.5 pb-3">
      <div className="flex items-baseline justify-between">
        <span className={LABEL}>Leverage</span>
        <span data-testid="copy-leverage" className="font-mono text-base text-foreground">
          {value}x
        </span>
      </div>
      <Slider
        className="mt-3"
        min={1}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next);
        }}
        thumbLabel="Leverage"
        valueText={(next) => `${next}x`}
      />
      <p className="mt-2 flex justify-between font-mono text-2xs text-faint">
        <span>1x</span>
        <span className="sr-only"> to </span>
        <span>{max}x max</span>
      </p>
    </div>
  );
}

/** Mark price, position size, margin and liquidation estimate. */
export function CopySummary({
  coin,
  mark,
  sizeUsd,
  leverage,
  side,
  maxLeverage,
  markLabel = "Mark price",
  children,
}: {
  coin: string;
  mark: number | undefined;
  sizeUsd: number;
  leverage: number;
  side: PositionSide;
  /** The coin's max leverage for the maintenance margin rate, when known. */
  maxLeverage: number | undefined;
  markLabel?: string;
  /** Extra rows at the end. */
  children?: ReactNode;
}) {
  const coinSize = positionSizeInCoin(sizeUsd, mark);
  const margin = estimateMargin(sizeUsd, leverage);
  const liquidation =
    mark === undefined ? null : estimateLiquidation({ entryPx: mark, leverage, side, maxLeverage });
  const liqDistance =
    liquidation && mark !== undefined ? (liquidation.liquidationPx - mark) / mark : null;

  return (
    <dl data-testid="copy-summary" className="divide-y rounded-md border">
      <SummaryRow label={markLabel}>
        <Price value={mark} className="-mr-1" />
      </SummaryRow>
      <SummaryRow label="Position size">
        {coinSize === null ? EMPTY_VALUE : `${formatSize(coinSize)} ${displaySymbol(coin)}`}
      </SummaryRow>
      <SummaryRow label="Est. margin">
        {margin === null ? EMPTY_VALUE : formatUsd(margin)}
      </SummaryRow>
      <SummaryRow label="Est. liquidation price">
        {liquidation === null ? (
          EMPTY_VALUE
        ) : (
          <span data-testid="copy-liquidation">
            {formatPrice(liquidation.liquidationPx)}
            {liqDistance !== null ? (
              <span className="ml-1.5 text-2xs text-faint">
                {formatPercent(liqDistance, { signed: true })}
              </span>
            ) : null}
          </span>
        )}
      </SummaryRow>
      {children}
    </dl>
  );
}

export function SummaryRow({
  label,
  children,
  testId,
}: {
  label: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex h-9 items-center justify-between gap-3 px-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground">{children}</dd>
    </div>
  );
}

const SIDES: readonly PositionSide[] = ["long", "short"];

/** Long / Short as native radio buttons: arrow keys work, and each option has text. */
export function SideToggle({
  name,
  value,
  onChange,
}: {
  name: string;
  value: PositionSide;
  onChange: (side: PositionSide) => void;
}) {
  return (
    <fieldset className="shrink-0">
      <legend className="sr-only">Side</legend>
      <div className="inline-flex h-8 gap-0.5 rounded-md border bg-surface p-0.5">
        {SIDES.map((side) => {
          const checked = value === side;
          const Icon = side === "long" ? ArrowUpRightIcon : ArrowDownRightIcon;
          return (
            <label
              key={side}
              className={cn(
                "relative inline-flex w-[4.5rem] cursor-pointer items-center justify-center gap-1 rounded-sm border border-transparent text-xs font-medium text-muted-foreground transition-colors select-none hover:text-foreground has-focus-visible:outline-1 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
                checked &&
                  side === "long" &&
                  "border-long/40 bg-long-dim text-long hover:text-long",
                checked &&
                  side === "short" &&
                  "border-short/40 bg-short-dim text-short hover:text-short",
              )}
            >
              <input
                type="radio"
                name={name}
                value={side}
                checked={checked}
                onChange={() => onChange(side)}
                className="sr-only"
                data-testid={`copy-side-${side}`}
              />
              <Icon aria-hidden="true" className="size-3.5" />
              {side === "long" ? "Long" : "Short"}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
