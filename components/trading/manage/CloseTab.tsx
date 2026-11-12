"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { LABEL, SummaryRow } from "@/components/copy-trade/CopyTradeFields";
import { signTone } from "@/components/shared/tone";
import { Slider } from "@/components/ui/slider";
import { useClosePosition, type CloseTrailingOutcome } from "@/hooks/useTradingActions";
import { displaySymbol } from "@/lib/assets";
import { EMPTY_VALUE, formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { Position } from "@/lib/hyperliquid/schemas";
import { MIN_ORDER_USD, NETWORK, networkLabel, TRADING_LIMITS } from "@/lib/trading/config";
import {
  CLOSE_PERCENT_PRESETS,
  closeFraction,
  closePreview,
  type ClosePreview,
  type OrderResult,
} from "@/lib/trading/order";
import { cn } from "@/lib/utils";

import { ErrorNotice, PrimaryButton, ResultNotice } from "../TradingParts";
import {
  BlockReason,
  Chip,
  closingTone,
  closingVerb,
  ReviewButtons,
  TabFooter,
  type ManageContext,
} from "./shared";

/** The label of the one button that sends the close. */
export function closeConfirmLabel(percent: number, network: string): string {
  return percent >= 100 ? `Close all on ${network}` : `Close ${percent}% on ${network}`;
}

/**
 * Close all or part of the position: one reduce-only IOC order at 1 %
 * through the mid, after a review. The per-order cap does not apply: a
 * close only shrinks risk.
 */
export function CloseTab({ ctx }: { ctx: ManageContext }) {
  const { id, coin, position, asset, mid, step } = ctx;
  const close = useClosePosition(ctx.owner, ctx.agent);
  const [percent, setPercentState] = useState(100);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [trailing, setTrailing] = useState<CloseTrailingOutcome | null>(null);

  function setPercent(next: number) {
    setPercentState(Math.round(closeFraction(next) * 100));
    setReviewing(false);
  }

  const fraction = closeFraction(percent);
  const preview: ClosePreview | null =
    position && asset && mid !== undefined
      ? closePreview({
          assetIndex: asset.index,
          szDecimals: asset.szDecimals,
          positionSide: position.side,
          positionSize: Math.abs(position.size),
          entryPx: position.entryPx,
          fraction,
          mid,
          slippage: TRADING_LIMITS[NETWORK].slippage,
        })
      : null;

  let blockReason = ctx.baseBlock;
  if (!blockReason && !preview) blockReason = "This close is too small to send.";
  else if (!blockReason && preview && fraction < 1 && preview.sizeUsd < MIN_ORDER_USD)
    blockReason = `A partial close must be at least $${MIN_ORDER_USD}. Close more, or close it all.`;

  function onConfirm() {
    if (!asset || !position || blockReason) return;
    setResult(null);
    setTrailing(null);
    close.mutate(
      { asset, position, fraction },
      {
        onSuccess: ({ result: outcome, trailing: trailingOutcome }) => {
          setResult(outcome);
          setTrailing(trailingOutcome);
          if (outcome.kind === "filled") {
            toast(
              `Closed ${formatSize(outcome.totalSz)} ${displaySymbol(coin)} at ${formatPrice(outcome.avgPx)} on ${NETWORK}`,
            );
          }
        },
        onSettled: () => setReviewing(false),
      },
    );
  }

  const showReview = step === 3 && reviewing && preview !== null && position !== undefined;
  const fullyClosed = result?.kind === "filled" && !position;
  const reasonId = `${id}-close-reason`;

  let primary: ReactNode;
  if (fullyClosed) {
    primary = (
      <PrimaryButton data-testid="close-done" onClick={ctx.onDone}>
        Done
      </PrimaryButton>
    );
  } else if (ctx.sharedPrimary) {
    primary = ctx.sharedPrimary;
  } else if (!showReview) {
    primary = (
      <PrimaryButton
        data-testid="review-close"
        onClick={() => {
          close.reset();
          setResult(null);
          setTrailing(null);
          setReviewing(true);
        }}
        disabled={blockReason !== null}
        aria-describedby={blockReason ? reasonId : undefined}
      >
        Review close
      </PrimaryButton>
    );
  } else {
    primary = (
      <ReviewButtons
        backTestId="review-back"
        confirmTestId="confirm-close"
        onBack={() => setReviewing(false)}
        onConfirm={onConfirm}
        pending={close.isPending}
        disabled={blockReason !== null}
        describedBy={blockReason ? reasonId : undefined}
        label={closeConfirmLabel(percent, NETWORK)}
        pendingLabel="Closing…"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {position ? (
        <CloseAmount
          id={id}
          percent={percent}
          onChange={setPercent}
          coin={coin}
          preview={preview}
        />
      ) : null}

      {showReview && preview && position ? (
        <CloseReviewCard position={position} preview={preview} percent={percent} />
      ) : null}

      {close.error ? <ErrorNotice error={close.error} /> : null}
      {result ? (
        <ResultNotice result={result} coin={coin} address={ctx.owner} verb="Closed" />
      ) : null}
      {trailing ? <TrailingEndNote outcome={trailing} coin={coin} /> : null}

      <TabFooter ctx={ctx}>
        {primary}
        {step === 3 && blockReason && !fullyClosed ? (
          <BlockReason id={reasonId} testId="close-block-reason" text={blockReason} />
        ) : null}
      </TabFooter>
    </div>
  );
}

/** What happened to the trailing stop of the coin after a full close. */
function TrailingEndNote({ outcome, coin }: { outcome: CloseTrailingOutcome; coin: string }) {
  const symbol = displaySymbol(coin);
  if (outcome.kind === "error") {
    return (
      <p role="alert" data-testid="close-trailing-note" className="text-2xs text-short">
        The trailing stop for {symbol} did not end: its stop order is still open. Cancel it in Open
        orders. <span className="text-muted-foreground">{outcome.message}</span>
      </p>
    );
  }
  return (
    <p data-testid="close-trailing-note" className="text-2xs text-muted-foreground">
      The trailing stop for {symbol} ended, and its stop order was cancelled.
      {outcome.leftover.length > 0 ? (
        <span className="text-short">
          {" "}
          An old stop order ({outcome.leftover.join(", ")}) is still open; cancel it in Open orders.
        </span>
      ) : null}
    </p>
  );
}

/** How much to close: preset chips and a 1 to 100% slider. */
function CloseAmount({
  id,
  percent,
  onChange,
  coin,
  preview,
}: {
  id: string;
  percent: number;
  onChange: (percent: number) => void;
  coin: string;
  preview: ClosePreview | null;
}) {
  return (
    <div className="rounded-md border bg-surface px-3 pt-2.5 pb-3">
      <div className="flex items-baseline justify-between">
        <span id={`${id}-amount`} className={LABEL}>
          Close
        </span>
        <span data-testid="close-percent" className="font-mono text-base text-foreground">
          {percent}%
        </span>
      </div>
      <div role="group" aria-labelledby={`${id}-amount`} className="mt-2 grid grid-cols-4 gap-1">
        {CLOSE_PERCENT_PRESETS.map((preset) => (
          <Chip
            key={preset}
            pressed={percent === preset}
            testId={`close-preset-${preset}`}
            onClick={() => onChange(preset)}
          >
            {preset === 100 ? "All" : `${preset}%`}
          </Chip>
        ))}
      </div>
      <Slider
        className="mt-3"
        min={1}
        max={100}
        step={1}
        value={[percent]}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next);
        }}
        thumbLabel="Share of the position to close"
        valueText={(next) => `${next}%`}
      />
      <p data-testid="close-size" className="mt-2 font-mono text-2xs text-muted-foreground">
        {preview
          ? `${formatSize(preview.sizeCoin)} ${displaySymbol(coin)} · ${formatUsd(preview.sizeUsd)}`
          : EMPTY_VALUE}
      </p>
    </div>
  );
}

/** The review before the close: what the order sends and the PnL it realises. */
function CloseReviewCard({
  position,
  preview,
  percent,
}: {
  position: Position;
  preview: ClosePreview;
  percent: number;
}) {
  const slippagePct = `${TRADING_LIMITS[NETWORK].slippage * 100}%`;
  return (
    <div data-testid="close-review-card" className="flex flex-col gap-2">
      <dl className="divide-y rounded-md border border-brand/40">
        <SummaryRow label="Network">
          <span className="font-sans font-medium text-brand">
            {networkLabel(NETWORK)}
            {NETWORK === "mainnet" ? " · real funds" : " · test funds"}
          </span>
        </SummaryRow>
        <SummaryRow label="Order">
          <span className={cn("font-sans", closingTone(position))}>
            {closingVerb(position)} {displaySymbol(position.coin)} perp · reduce-only
          </span>
        </SummaryRow>
        <SummaryRow label="Size">
          <span data-testid="close-review-size">
            {formatSize(preview.sizeCoin)} {displaySymbol(position.coin)}
            <span className="ml-1.5 text-faint">{percent}%</span>
          </span>
        </SummaryRow>
        <SummaryRow label={`Worst fill price (${slippagePct} from mid)`}>
          <span data-testid="close-review-worst-price">{formatPrice(preview.worstPrice)}</span>
        </SummaryRow>
        <SummaryRow label="Est. realized PnL">
          <span data-testid="close-review-pnl" className={signTone(preview.estPnl)}>
            {formatUsd(preview.estPnl, { signed: true })}
          </span>
        </SummaryRow>
      </dl>
      <p className="text-2xs text-muted-foreground">
        Reduce-only, immediate-or-cancel. It can only shrink this position. Unfilled size is
        cancelled. Estimates ignore fees.
      </p>
    </div>
  );
}
