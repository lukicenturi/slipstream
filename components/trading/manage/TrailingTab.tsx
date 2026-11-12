"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { LABEL, SummaryRow } from "@/components/copy-trade/CopyTradeFields";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/useNow";
import { useTrackerRunning, useTrailingConfigs } from "@/hooks/useTrailingStops";
import {
  useStartTrailing,
  useStopTrailing,
  type StartTrailingResult,
} from "@/hooks/useTradingActions";
import type { ReplaceError } from "@/lib/trading/actions";
import { displaySymbol } from "@/lib/assets";
import { EMPTY_VALUE, formatPrice, formatRelativeTime, formatSize } from "@/lib/format";
import type { Position } from "@/lib/hyperliquid/schemas";
import { NETWORK, networkLabel } from "@/lib/trading/config";
import { TPSL_MARKET_SLIPPAGE } from "@/lib/trading/tpsl";
import {
  clampTrailPct,
  initialStop,
  TRAIL_MAX_PCT,
  TRAIL_MIN_INTERVAL_MS,
  TRAIL_MIN_PCT,
  TRAIL_MIN_STEP_PCT,
  TRAIL_PRESETS_PCT,
  TRAILING_MODIFY_VERIFIED,
  type TrailingConfig,
} from "@/lib/trading/trailing";
import { cn } from "@/lib/utils";

import { ErrorNotice, PrimaryButton, ResultNotice, Spinner } from "../TradingParts";
import {
  BlockReason,
  Chip,
  closingTone,
  closingVerb,
  ReplaceErrors,
  ReviewButtons,
  TabFooter,
  type ManageContext,
} from "./shared";

const INTERVAL_S = TRAIL_MIN_INTERVAL_MS / 1000;
const pctFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "2%" or "0.5%". */
function pctLabel(percent: number): string {
  return `${pctFormat.format(percent)}%`;
}

/** Shown until a real trailing `modify` is seen on a funded account (DECISIONS.md, 2026-11-12). */
function UnverifiedNote() {
  if (TRAILING_MODIFY_VERIFIED) return null;
  return (
    <p data-testid="trailing-unverified" className="text-2xs text-brand">
      Trailing updates are not yet verified on a funded account.
    </p>
  );
}

/**
 * The trailing stop: an on-chain stop-loss trigger order (reduce-only,
 * market with a 10 % slippage limit) that this tab moves in the position's
 * favour. Without a config: pick a distance, review, start. With one: its
 * status and two ways to stop.
 */
export function TrailingTab({ ctx }: { ctx: ManageContext }) {
  const configs = useTrailingConfigs(ctx.owner);
  const config = configs.find((entry) => entry.coin === ctx.coin) ?? null;
  // The outcome of the last start lives here, not in the start view: the config write swaps
  // the start view for the status view before the replace-cancel settles, and the status
  // view must still show "The old stop loss is still open".
  const [outcome, setOutcome] = useState<StartTrailingResult | null>(null);
  // When the config goes away (stopped, or ended), the old outcome no longer applies.
  const [hadConfig, setHadConfig] = useState(config !== null);
  if (hadConfig !== (config !== null)) {
    setHadConfig(config !== null);
    if (config === null) setOutcome(null);
  }
  return config ? (
    <TrailingStatus ctx={ctx} config={config} replaceErrors={outcome?.replaceErrors ?? []} />
  ) : (
    <TrailingStart ctx={ctx} outcome={outcome} onOutcome={setOutcome} />
  );
}

function TrailingStart({
  ctx,
  outcome,
  onOutcome,
}: {
  ctx: ManageContext;
  /** The outcome of the last start, kept by `TrailingTab`. */
  outcome: StartTrailingResult | null;
  onOutcome: (outcome: StartTrailingResult | null) => void;
}) {
  const { id, coin, position, asset, mid, step } = ctx;
  const start = useStartTrailing(ctx.owner, ctx.agent);
  const [percent, setPercentState] = useState<number>(2);
  const [custom, setCustom] = useState("");
  const [reviewing, setReviewing] = useState(false);

  function setPercent(next: number) {
    setPercentState(next);
    setReviewing(false);
  }

  const customValue = custom.trim() === "" ? null : Number(custom.replace(",", "."));
  const customError =
    customValue === null
      ? null
      : !Number.isFinite(customValue) || customValue < TRAIL_MIN_PCT || customValue > TRAIL_MAX_PCT
        ? `Enter ${TRAIL_MIN_PCT} to ${TRAIL_MAX_PCT}%.`
        : null;
  const trailPercent = customValue !== null && !customError ? customValue : percent;
  const trailPct = (clampTrailPct(trailPercent) ?? 2) / 100;

  let stopPx: number | null = null;
  if (position && asset && mid !== undefined) {
    try {
      stopPx = Number(initialStop(position.side, mid, trailPct, asset.szDecimals));
    } catch {
      stopPx = null;
    }
  }
  const existing = ctx.tpsl.sl;

  let blockReason = ctx.baseBlock;
  // Until the book is known, the start cannot see (and replace) a stop loss that is already set.
  if (!blockReason && !ctx.ordersReady) blockReason = "Loading open orders.";
  else if (!blockReason && customError) blockReason = customError;
  else if (!blockReason && stopPx === null) blockReason = "The stop cannot be computed.";

  function onConfirm() {
    if (!asset || !position || blockReason) return;
    onOutcome(null);
    // `mutateAsync`, not `mutate` with callbacks: a resting stop writes the config before the
    // old stop loss is cancelled, so this view unmounts before the mutation settles, and React
    // Query skips the `mutate` callbacks then. The promise still resolves; `TrailingTab` keeps
    // the outcome. A failure shows `start.error` (no config was written, so this view stays).
    start
      .mutateAsync({ asset, position, trailPct, replaceOid: existing?.oid })
      .then((next) => {
        onOutcome(next);
        if (next.result.kind === "resting") {
          toast(`Trailing stop started for ${displaySymbol(coin)} on ${NETWORK}`);
        }
      })
      .catch(() => undefined)
      .finally(() => setReviewing(false));
  }

  const showReview = step === 3 && reviewing && stopPx !== null && blockReason === null;
  const reasonId = `${id}-trailing-reason`;
  const customErrorId = `${id}-trail-custom-error`;
  const direction = position?.side === "short" ? "down" : "up";
  const moveWord = position?.side === "short" ? "falls" : "rises";
  const sign = position?.side === "short" ? "+" : "−";

  let primary: ReactNode;
  if (ctx.sharedPrimary) primary = ctx.sharedPrimary;
  else if (!showReview) {
    primary = (
      <PrimaryButton
        data-testid="review-trailing"
        onClick={() => {
          start.reset();
          onOutcome(null);
          setReviewing(true);
        }}
        disabled={blockReason !== null}
        aria-describedby={blockReason ? reasonId : undefined}
      >
        Review trailing stop
      </PrimaryButton>
    );
  } else {
    primary = (
      <ReviewButtons
        backTestId="trailing-review-back"
        confirmTestId="confirm-trailing"
        onBack={() => setReviewing(false)}
        onConfirm={onConfirm}
        pending={start.isPending}
        disabled={blockReason !== null}
        describedBy={blockReason ? reasonId : undefined}
        label={`Start trailing stop on ${NETWORK}`}
        pendingLabel="Starting…"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {position ? (
        <div className="rounded-md border bg-surface px-3 pt-2.5 pb-3">
          <div className="flex items-baseline justify-between">
            <span id={`${id}-trail`} className={LABEL}>
              Trail distance
            </span>
            <span data-testid="trail-percent" className="font-mono text-base text-foreground">
              {pctLabel(trailPercent)}
            </span>
          </div>
          <div role="group" aria-labelledby={`${id}-trail`} className="mt-2 grid grid-cols-5 gap-1">
            {TRAIL_PRESETS_PCT.map((preset) => (
              <Chip
                key={preset}
                pressed={customValue === null && percent === preset}
                testId={`trail-preset-${preset}`}
                onClick={() => {
                  setCustom("");
                  setPercent(preset);
                }}
              >
                {preset}%
              </Chip>
            ))}
            <label className="relative">
              <span className="sr-only">
                Custom trail distance in percent, {TRAIL_MIN_PCT} to {TRAIL_MAX_PCT}
              </span>
              <input
                data-testid="trail-custom-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Custom"
                value={custom}
                onChange={(event) => {
                  setCustom(event.target.value);
                  setReviewing(false);
                }}
                aria-invalid={customError ? true : undefined}
                aria-describedby={customError ? customErrorId : undefined}
                className={cn(
                  "h-7 w-full min-w-0 rounded-sm border bg-background pr-4 pl-1.5 font-mono text-xs text-foreground placeholder:font-sans placeholder:text-faint aria-invalid:border-short/60",
                  customValue !== null && !customError && "border-brand/60",
                )}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-2xs text-faint"
              >
                %
              </span>
            </label>
          </div>
          <p data-testid="trail-preview" className="mt-2 text-2xs text-muted-foreground">
            {customError ? (
              <span id={customErrorId} role="alert" className="text-short">
                {customError}
              </span>
            ) : (
              <>
                Initial stop{" "}
                <span data-testid="trail-initial-stop" className="font-mono text-foreground">
                  {stopPx === null ? EMPTY_VALUE : formatPrice(stopPx)}
                </span>{" "}
                <span className="font-mono">
                  ({sign}
                  {pctLabel(trailPercent)})
                </span>{" "}
                · moves {direction} as the price {moveWord} · updates at most every {INTERVAL_S} s
                while a Slipstream tab is open on this device
              </>
            )}
          </p>
        </div>
      ) : null}

      <UnverifiedNote />

      {existing && position ? (
        <p
          data-testid="trailing-replaces-sl"
          className="rounded-sm border border-brand/40 bg-brand-dim px-2.5 py-2 text-2xs text-foreground"
        >
          A stop loss is already set at{" "}
          <span className="font-mono">
            {existing.triggerPx === null ? EMPTY_VALUE : formatPrice(existing.triggerPx)}
          </span>
          . Trailing would replace it.
        </p>
      ) : null}

      {showReview && position && stopPx !== null ? (
        <TrailingReviewCard
          position={position}
          stopPx={stopPx}
          trailPercent={trailPercent}
          replacesPx={existing?.triggerPx ?? null}
        />
      ) : null}

      {start.error ? <ErrorNotice error={start.error} /> : null}
      {outcome ? <ResultNotice result={outcome.result} coin={coin} address={ctx.owner} /> : null}
      <ReplaceErrors errors={outcome?.replaceErrors ?? []} testId="trailing-replace-error" />

      <TabFooter ctx={ctx}>
        {primary}
        {step === 3 && blockReason ? (
          <BlockReason id={reasonId} testId="trailing-block-reason" text={blockReason} />
        ) : null}
      </TabFooter>
    </div>
  );
}

function TrailingReviewCard({
  position,
  stopPx,
  trailPercent,
  replacesPx,
}: {
  position: Position;
  stopPx: number;
  trailPercent: number;
  replacesPx: number | null;
}) {
  const symbol = displaySymbol(position.coin);
  return (
    <div data-testid="trailing-review-card" className="flex flex-col gap-2">
      <dl className="divide-y rounded-md border border-brand/40">
        <SummaryRow label="Network">
          <span className="font-sans font-medium text-brand">
            {networkLabel(NETWORK)}
            {NETWORK === "mainnet" ? " · real funds" : " · test funds"}
          </span>
        </SummaryRow>
        <SummaryRow label="Order">
          <span className={cn("font-sans", closingTone(position))}>
            {closingVerb(position)} {symbol} perp · stop loss · reduce-only
          </span>
        </SummaryRow>
        <SummaryRow label="Size">
          <span className="font-sans">
            Whole position{" "}
            <span className="font-mono text-faint">
              {formatSize(Math.abs(position.size))} {symbol}
            </span>
          </span>
        </SummaryRow>
        <SummaryRow label="Initial stop">
          <span data-testid="trailing-review-stop">{formatPrice(stopPx)}</span>
        </SummaryRow>
        <SummaryRow label="Trail">{pctLabel(trailPercent)}</SummaryRow>
        {replacesPx !== null ? (
          <SummaryRow label="Then cancels" testId="trailing-review-cancel">
            <span className="font-sans text-muted-foreground">
              Stop loss at{" "}
              <span className="font-mono text-foreground">{formatPrice(replacesPx)}</span>
            </span>
          </SummaryRow>
        ) : null}
      </dl>
      <p className="text-2xs text-muted-foreground">
        The stop is on-chain and stays if you close this tab. Slipstream moves it only in your
        favour, at most every {INTERVAL_S} s and by at least {TRAIL_MIN_STEP_PCT}%, while a tab is
        open on this device with this agent. It triggers on the mark price and sends a market order
        with a {TPSL_MARKET_SLIPPAGE * 100}% slippage limit.
        {replacesPx !== null
          ? " The new stop goes out first; the old stop loss is cancelled only after the exchange accepts it."
          : null}
      </p>
    </div>
  );
}

function TrailingStatus({
  ctx,
  config,
  replaceErrors,
}: {
  ctx: ManageContext;
  config: TrailingConfig;
  /** The old stop loss that the start replaced, when its cancel failed. */
  replaceErrors: readonly ReplaceError[];
}) {
  const now = useNow();
  const running = useTrackerRunning();
  const stop = useStopTrailing(ctx.owner, ctx.agent);
  const [confirming, setConfirming] = useState<"keep" | "cancel" | null>(null);
  const symbol = displaySymbol(config.coin);
  const bestLabel = config.positionSide === "long" ? "High-water mark" : "Low-water mark";

  // The view stays mounted while the stop is pending: the config goes only after the cancel settles.
  function onStop(cancel: boolean) {
    const stopPx = config.stopPx;
    // `mutateAsync`, not `mutate` with callbacks: a success removes the config, so this view
    // unmounts before the mutation settles, and React Query skips the `mutate` callbacks then.
    // The promise still resolves. A failure keeps the config, and the view shows `stop.error`.
    stop
      .mutateAsync({ coin: config.coin, cancel })
      .then((result) => {
        // Another tab or the tracker ended it already: nothing was sent, so no success toast.
        if (result.kind === "already-gone") return;
        const leftover =
          result.leftover.length > 0
            ? ` An old stop order (${result.leftover.join(", ")}) is still open; cancel it in Open orders.`
            : "";
        toast(
          cancel
            ? `Trailing stopped and the stop order cancelled for ${symbol}.${leftover}`
            : `Trailing stopped for ${symbol}. The stop stays at ${formatPrice(stopPx)}.`,
        );
      })
      .catch(() => undefined)
      .finally(() => setConfirming(null));
  }

  return (
    <div className="flex flex-col gap-3">
      <div data-testid="trailing-status" className="flex flex-col gap-2">
        <dl className="divide-y rounded-md border">
          <SummaryRow label="Current stop">
            <span data-testid="trailing-status-stop">{formatPrice(config.stopPx)}</span>
          </SummaryRow>
          <SummaryRow label={bestLabel}>{formatPrice(config.highWater)}</SummaryRow>
          <SummaryRow label="Trail">{pctLabel(config.trailPct * 100)}</SummaryRow>
          <SummaryRow label="Last update">
            <span className="font-sans">{formatRelativeTime(config.lastModifyAt, now)}</span>
          </SummaryRow>
          <SummaryRow label="Status">
            <span
              data-testid="trailing-status-state"
              data-running={running ? "true" : "false"}
              className={cn("font-sans", running ? "text-long" : "text-brand")}
            >
              {running ? "Active in this tab" : "Paused: open the app to resume"}
            </span>
          </SummaryRow>
        </dl>
        <p className="text-2xs text-muted-foreground">
          The stop is on-chain (oid {config.oid}). Closing every Slipstream tab pauses the trailing;
          the stop stays where it is.
        </p>
        <UnverifiedNote />
      </div>

      <ReplaceErrors errors={replaceErrors} testId="trailing-replace-error" />
      {stop.error ? <ErrorNotice error={stop.error} /> : null}

      <TabFooter ctx={ctx}>
        {ctx.sharedPrimary ??
          (confirming ? (
            <div className="flex w-full flex-col gap-2">
              <p className="text-center text-2xs text-muted-foreground">
                {confirming === "keep"
                  ? `Stop trailing ${symbol}? The stop stays at ${formatPrice(config.stopPx)}.`
                  : `Stop trailing ${symbol} and cancel the stop order? The position will have no stop.`}
              </p>
              <div className="flex w-full gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-10 w-24 shrink-0 text-sm"
                  data-testid="trailing-stop-back"
                  disabled={stop.isPending}
                  onClick={() => setConfirming(null)}
                >
                  Back
                </Button>
                <PrimaryButton
                  data-testid="trailing-stop-confirm"
                  className="h-10 min-w-0 flex-1 text-sm font-semibold"
                  disabled={stop.isPending}
                  onClick={() => onStop(confirming === "cancel")}
                >
                  {stop.isPending ? <Spinner /> : null}
                  {stop.isPending
                    ? confirming === "keep"
                      ? "Stopping…"
                      : "Cancelling…"
                    : confirming === "keep"
                      ? "Stop trailing"
                      : "Stop and cancel"}
                </PrimaryButton>
              </div>
            </div>
          ) : (
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-9 text-xs"
                data-testid="trailing-stop-keep"
                onClick={() => setConfirming("keep")}
              >
                Stop trailing (keep the stop)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-9 text-xs hover:border-short/60 hover:text-short"
                data-testid="trailing-stop-cancel"
                onClick={() => setConfirming("cancel")}
              >
                Stop and cancel the stop order
              </Button>
            </div>
          ))}
      </TabFooter>
    </div>
  );
}
