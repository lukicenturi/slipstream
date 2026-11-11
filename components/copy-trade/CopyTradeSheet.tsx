"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Price } from "@/components/shared/Price";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { useMid } from "@/hooks/useMid";
import {
  DEFAULT_SIZE_USD,
  SIZE_MAX_USD,
  SIZE_MIN_USD,
  SIZE_STEP_USD,
  clampSizeUsd,
  initialLeverage,
  parseSizeInput,
  resolveMaxLeverage,
} from "@/lib/calc/copyTrade";
import { estimateLiquidation, estimateMargin, positionSizeInCoin } from "@/lib/calc/liquidation";
import { EMPTY_VALUE, formatPercent, formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { PositionSide } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

import type { CopyTradePrefill } from "./CopyTradeProvider";

export const DEMO_CONFIRM_LABEL = "Demo, no order is placed";
export const DEMO_TOAST = "Demo only. No order was sent.";

const LABEL = "text-2xs font-medium tracking-wide text-muted-foreground uppercase";

const sizeInputFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "$1,250" or "$1,250.5": no forced cents, unlike formatUsd below 1,000. */
function formatSizeUsd(value: number): string {
  return `$${sizeInputFormat.format(value)}`;
}

/**
 * The demo copy-trade sheet. A bottom sheet on every screen size: full
 * width on mobile, 480 px wide and centred from `sm` up. It shows
 * estimates only. Confirm shows a toast and closes the sheet; nothing
 * else happens and no request leaves the browser.
 */
export function CopyTradeSheet({
  open,
  onOpenChange,
  prefill,
  session,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: CopyTradePrefill | null;
  session: number;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-testid="copy-trade-sheet"
        onCloseAutoFocus={onCloseAutoFocus}
        className="mx-auto max-h-[92dvh] w-full max-w-[480px] gap-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
      >
        {prefill ? (
          <CopyTradeForm key={session} prefill={prefill} onDone={() => onOpenChange(false)} />
        ) : (
          <>
            <SheetTitle className="sr-only">Copy trade</SheetTitle>
            <SheetDescription className="sr-only">No trade selected.</SheetDescription>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CopyTradeForm({ prefill, onDone }: { prefill: CopyTradePrefill; onDone: () => void }) {
  const { coin } = prefill;
  const id = useId();
  const maxLeverage = resolveMaxLeverage(prefill.maxLeverage);

  const [side, setSide] = useState<PositionSide>(prefill.side);
  const [sizeUsd, setSizeUsd] = useState(() => clampSizeUsd(prefill.sizeUsd ?? DEFAULT_SIZE_USD));
  // The raw text while the user types; null shows the formatted size.
  const [draft, setDraft] = useState<string | null>(null);
  const [leverage, setLeverage] = useState(() => initialLeverage(prefill.leverage, maxLeverage));

  const liveMid = useMid(coin);
  const mark = liveMid ?? prefill.markPx;

  const coinSize = positionSizeInCoin(sizeUsd, mark);
  const margin = estimateMargin(sizeUsd, leverage);
  const liquidation =
    mark === undefined
      ? null
      : estimateLiquidation({ entryPx: mark, leverage, side, maxLeverage: prefill.maxLeverage });
  const liqDistance =
    liquidation && mark !== undefined ? (liquidation.liquidationPx - mark) / mark : null;

  function onSizeText(text: string) {
    setDraft(text);
    const value = parseSizeInput(text);
    if (value !== null && value >= SIZE_MIN_USD && value <= SIZE_MAX_USD) setSizeUsd(value);
  }

  function commitSizeText() {
    if (draft === null) return;
    const value = parseSizeInput(draft);
    if (value !== null) setSizeUsd(clampSizeUsd(value));
    setDraft(null);
  }

  function onConfirm() {
    // Demo only: no request, no signature, no order.
    toast(DEMO_TOAST);
    onDone();
  }

  return (
    <>
      <SheetHeader className="h-[52px] flex-row items-center gap-2 border-b px-4 py-0 pr-12">
        <SheetTitle>Copy trade</SheetTitle>
        <Badge>Demo</Badge>
      </SheetHeader>
      <SheetDescription className="sr-only">
        Set a side, a size and a leverage to see estimates. This is a demo. No order is placed.
      </SheetDescription>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className={LABEL}>Asset</p>
            <p className="mt-0.5 truncate text-lg font-semibold text-foreground">
              {coin}
              <span className="ml-1.5 text-2xs font-normal text-faint">Perp</span>
            </p>
          </div>
          <SideToggle name={`${id}-side`} value={side} onChange={setSide} />
        </div>

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
              value={draft ?? sizeInputFormat.format(sizeUsd)}
              onChange={(event) => onSizeText(event.target.value)}
              onBlur={commitSizeText}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitSizeText();
              }}
              aria-describedby={`${id}-size-range`}
              className="w-full min-w-0 rounded-sm bg-transparent font-mono text-hero text-foreground"
            />
          </div>
          <Slider
            className="mt-3"
            min={SIZE_MIN_USD}
            max={SIZE_MAX_USD}
            step={SIZE_STEP_USD}
            value={[sizeUsd]}
            onValueChange={([value]) => {
              if (value === undefined) return;
              setSizeUsd(value);
              setDraft(null);
            }}
            thumbLabel="Size in USD"
            valueText={formatSizeUsd}
          />
          <p
            id={`${id}-size-range`}
            className="mt-2 flex justify-between font-mono text-2xs text-faint"
          >
            <span>{formatSizeUsd(SIZE_MIN_USD)}</span>
            <span className="sr-only"> to </span>
            <span>{formatSizeUsd(SIZE_MAX_USD)}</span>
          </p>
        </div>

        <div className="rounded-md border bg-surface px-3 pt-2.5 pb-3">
          <div className="flex items-baseline justify-between">
            <span className={LABEL}>Leverage</span>
            <span data-testid="copy-leverage" className="font-mono text-base text-foreground">
              {leverage}x
            </span>
          </div>
          <Slider
            className="mt-3"
            min={1}
            max={maxLeverage}
            step={1}
            value={[leverage]}
            onValueChange={([value]) => {
              if (value !== undefined) setLeverage(value);
            }}
            thumbLabel="Leverage"
            valueText={(value) => `${value}x`}
          />
          <p className="mt-2 flex justify-between font-mono text-2xs text-faint">
            <span>1x</span>
            <span className="sr-only"> to </span>
            <span>{maxLeverage}x max</span>
          </p>
        </div>

        <dl data-testid="copy-summary" className="divide-y rounded-md border">
          <SummaryRow label="Mark price">
            <Price value={mark} className="-mr-1" />
          </SummaryRow>
          <SummaryRow label="Position size">
            {coinSize === null ? EMPTY_VALUE : `${formatSize(coinSize)} ${coin}`}
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
        </dl>

        <p className="text-2xs text-muted-foreground">
          Estimate for an isolated position opened at the mark price. It ignores cross margin,
          funding and fees. Slipstream sends no order.
        </p>
      </div>

      <SheetFooter className="border-t px-4 pt-3 pb-4">
        <Button
          type="button"
          size="lg"
          className="h-10 w-full text-sm font-semibold"
          onClick={onConfirm}
          data-testid="copy-confirm"
        >
          {DEMO_CONFIRM_LABEL}
        </Button>
      </SheetFooter>
    </>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-3 px-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground">{children}</dd>
    </div>
  );
}

const SIDES: readonly PositionSide[] = ["long", "short"];

/** Long / Short as native radio buttons: arrow keys work, and each option has text. */
function SideToggle({
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
