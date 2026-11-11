"use client";

import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { CloseTarget } from "@/components/close-position/ClosePositionProvider";
import {
  LABEL,
  SHEET_BODY_CLASS,
  SHEET_FOOTER_CLASS,
  SheetBar,
  SummaryRow,
} from "@/components/copy-trade/CopyTradeFields";
import { AssetIcon } from "@/components/shared/AssetIcon";
import { Price } from "@/components/shared/Price";
import { Side } from "@/components/shared/Side";
import { signTone } from "@/components/shared/tone";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { forgetAgent } from "@/hooks/useAgent";
import { useMid } from "@/hooks/useMid";
import { useNow } from "@/hooks/useNow";
import { useRiskAck } from "@/hooks/useRiskAck";
import { useTradingMeta } from "@/hooks/useTradingMeta";
import { useApproveAgent, useClosePosition } from "@/hooks/useTradingActions";
import { useTradingSession } from "@/hooks/useTradingSession";
import { displaySymbol } from "@/lib/assets";
import { unrealizedPnl } from "@/lib/calc/positions";
import { EMPTY_VALUE, formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { Position } from "@/lib/hyperliquid/schemas";
import { MIN_ORDER_USD, NETWORK, networkLabel, TRADING_LIMITS } from "@/lib/trading/config";
import type { TradingError } from "@/lib/trading/errors";
import {
  CLOSE_PERCENT_PRESETS,
  closeFraction,
  closePreview,
  findAsset,
  type ClosePreview,
  type OrderResult,
} from "@/lib/trading/order";
import { isAcknowledged } from "@/lib/trading/riskAck";
import { cn } from "@/lib/utils";

import { ConnectWalletPopover } from "./ConnectWallet";
import { NetworkBadge } from "./NetworkBadge";
import {
  AgentBlock,
  ErrorNotice,
  PrimaryButton,
  ResultNotice,
  RiskPanel,
  Spinner,
} from "./TradingParts";
import { TradingSteps } from "./TradingSteps";

/** The label of the one button that sends the close. */
export function closeConfirmLabel(percent: number, network: string): string {
  return percent >= 100 ? `Close all on ${network}` : `Close ${percent}% on ${network}`;
}

/**
 * Close all or part of one of your positions, on the build's network.
 * It reads the position from the live account (so a partial close updates
 * the size), sends one reduce-only IOC order at 1% through the mid, and
 * always shows a review first. The wallet, risk and agent steps are the
 * same as the copy-trade sheet. The per-order cap does not apply: a close
 * only shrinks risk.
 */
export default function ClosePositionForm({
  target,
  open,
  onDone,
}: {
  target: CloseTarget;
  open: boolean;
  onDone: () => void;
}) {
  const coin = target.position.coin;
  const id = useId();
  const now = useNow();
  const session = useTradingSession({ live: open });
  const meta = useTradingMeta(open);
  const mid = useMid(coin);
  const approve = useApproveAgent(session.address);
  const close = useClosePosition(session.address, session.agent);
  const riskAck = useRiskAck();

  const [percent, setPercentState] = useState(100);
  const [reviewing, setReviewing] = useState(false);
  const [riskChecked, setRiskChecked] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);

  function setPercent(next: number) {
    setPercentState(Math.round(closeFraction(next) * 100));
    setReviewing(false);
  }

  // The live position: after a partial close the size shrinks; after a full close it is gone.
  const livePosition: Position | undefined = session.account.data
    ? session.account.data.positions.find((entry) => entry.coin === coin)
    : target.position;
  const isOwner = session.address === target.owner;
  const asset = meta.data ? findAsset(meta.data, coin) : null;
  const fraction = closeFraction(percent);
  const preview: ClosePreview | null =
    livePosition && asset && mid !== undefined
      ? closePreview({
          assetIndex: asset.index,
          szDecimals: asset.szDecimals,
          positionSide: livePosition.side,
          positionSize: Math.abs(livePosition.size),
          entryPx: livePosition.entryPx,
          fraction,
          mid,
          slippage: TRADING_LIMITS[NETWORK].slippage,
        })
      : null;

  const step = session.status === "disconnected" ? 1 : session.status === "connected" ? 2 : 3;
  const needsRiskAck = NETWORK === "mainnet" && step === 2 && !isAcknowledged(riskAck.value, now);

  let blockReason: string | null = null;
  if (!isOwner && session.address) blockReason = "This position belongs to another address.";
  else if (!livePosition) blockReason = "This position is closed.";
  else if (meta.isPending) blockReason = `Loading ${NETWORK} markets.`;
  else if (meta.isError) blockReason = `${networkLabel(NETWORK)} markets did not load.`;
  else if (!asset) blockReason = `Not listed on ${NETWORK}.`;
  else if (mid === undefined) blockReason = `Waiting for the ${NETWORK} price.`;
  else if (!preview) blockReason = "This close is too small to send.";
  else if (fraction < 1 && preview.sizeUsd < MIN_ORDER_USD)
    blockReason = `A partial close must be at least $${MIN_ORDER_USD}. Close more, or close it all.`;

  function onConfirmClose() {
    if (!asset || !livePosition || blockReason) return;
    setResult(null);
    close.mutate(
      { asset, position: livePosition, fraction },
      {
        onSuccess: (outcome) => {
          setResult(outcome);
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

  function onForgetAgent() {
    if (!session.address) return;
    forgetAgent(session.address);
    setResult(null);
    setReviewing(false);
    approve.reset();
    close.reset();
  }

  const error: TradingError | null = approve.error ?? close.error;
  const showReview = step === 3 && reviewing && preview !== null && livePosition !== undefined;
  const fullyClosed = result?.kind === "filled" && !livePosition;

  let primary: ReactNode;
  if (step === 1) {
    primary = (
      <ConnectWalletPopover side="top" align="center">
        <PrimaryButton disabled={session.isConnecting}>
          {session.isConnecting ? <Spinner /> : null}
          Connect wallet
        </PrimaryButton>
      </ConnectWalletPopover>
    );
  } else if (fullyClosed) {
    primary = (
      <PrimaryButton data-testid="close-done" onClick={onDone}>
        Done
      </PrimaryButton>
    );
  } else if (step === 2 && needsRiskAck) {
    primary = (
      <PrimaryButton
        data-testid="risk-continue"
        onClick={() => riskAck.acknowledge()}
        disabled={!riskChecked}
        aria-describedby={`${id}-risk`}
      >
        Continue
      </PrimaryButton>
    );
  } else if (step === 2) {
    primary = (
      <PrimaryButton
        onClick={() => {
          close.reset();
          approve.mutate();
        }}
        disabled={approve.isPending}
      >
        {approve.isPending ? <Spinner /> : null}
        {approve.isPending ? "Waiting for signature…" : "Approve agent"}
      </PrimaryButton>
    );
  } else if (!showReview) {
    primary = (
      <PrimaryButton
        data-testid="review-close"
        onClick={() => {
          close.reset();
          setResult(null);
          setReviewing(true);
        }}
        disabled={blockReason !== null}
        aria-describedby={blockReason ? `${id}-reason` : undefined}
      >
        Review close
      </PrimaryButton>
    );
  } else {
    primary = (
      <div className="flex w-full gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          data-testid="review-back"
          className="h-10 w-24 shrink-0 text-sm"
          onClick={() => setReviewing(false)}
          disabled={close.isPending}
        >
          Back
        </Button>
        <PrimaryButton
          data-testid="confirm-close"
          onClick={onConfirmClose}
          disabled={close.isPending || blockReason !== null}
          aria-describedby={blockReason ? `${id}-reason` : undefined}
          className="h-10 min-w-0 flex-1 text-sm font-semibold"
        >
          {close.isPending ? <Spinner /> : null}
          {close.isPending ? "Closing…" : closeConfirmLabel(percent, NETWORK)}
        </PrimaryButton>
      </div>
    );
  }

  return (
    <>
      <SheetBar title="Close position" badge={<NetworkBadge network={NETWORK} />} />
      <SheetDescription className="sr-only">
        Close all or part of this position with a reduce-only market order on Hyperliquid {NETWORK}.
        You review the order before it is sent.
      </SheetDescription>

      <div className={SHEET_BODY_CLASS}>
        <PositionSummary
          position={livePosition ?? target.position}
          mid={mid}
          closed={!livePosition}
        />

        {livePosition ? (
          <CloseAmount
            id={id}
            percent={percent}
            onChange={setPercent}
            coin={coin}
            preview={preview}
          />
        ) : null}

        {showReview && preview && livePosition ? (
          <CloseReviewCard position={livePosition} preview={preview} percent={percent} />
        ) : null}

        <section
          aria-label={`${networkLabel(NETWORK)} trading`}
          className="flex flex-col gap-2 rounded-md border px-3 pt-1 pb-2.5"
        >
          <TradingSteps current={step} />
          {needsRiskAck ? (
            <RiskPanel id={id} checked={riskChecked} onCheckedChange={setRiskChecked} />
          ) : (
            <p className="text-2xs text-muted-foreground">
              {step === 1
                ? "Connect the wallet that holds this position."
                : step === 2
                  ? "One signature approves a Slipstream agent key that stays in this browser."
                  : "A reduce-only IOC order at 1% through the mid. You review it before it is sent."}
            </p>
          )}
          {error ? <ErrorNotice error={error} /> : null}
          {result ? (
            <ResultNotice result={result} coin={coin} address={session.address} verb="Closed" />
          ) : null}
        </section>
      </div>

      <SheetFooter className={SHEET_FOOTER_CLASS}>
        {primary}
        {step === 3 && blockReason && !fullyClosed ? (
          <p
            id={`${id}-reason`}
            data-testid="close-block-reason"
            className="text-center text-2xs text-muted-foreground"
          >
            {blockReason}
          </p>
        ) : null}
        {session.agent ? (
          <AgentBlock agent={session.agent} now={now} onForget={onForgetAgent} />
        ) : null}
      </SheetFooter>
    </>
  );
}

/** The position being closed, with the live mid and unrealized PnL. */
function PositionSummary({
  position,
  mid,
  closed,
}: {
  position: Position;
  mid: number | undefined;
  closed: boolean;
}) {
  const absSize = Math.abs(position.size);
  const pnl = unrealizedPnl(position, mid);
  const sizeUsd = mid === undefined ? position.positionValue : absSize * mid;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-lg font-semibold text-foreground">
          <AssetIcon coin={position.coin} size={24} />
          <span className="truncate">{displaySymbol(position.coin)}</span>
          <span className="text-2xs font-normal text-faint">Perp</span>
        </p>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Side
            label={position.side === "long" ? "Long" : "Short"}
            tone={position.side === "long" ? "long" : "short"}
          />
          <span className="font-mono text-foreground">{position.leverage}x</span>
          {position.leverageType}
        </span>
      </div>
      {closed ? (
        <p data-testid="position-closed" className="text-xs text-muted-foreground">
          This position is closed.
        </p>
      ) : (
        <dl data-testid="close-position-summary" className="divide-y rounded-md border">
          <SummaryRow label="Size">
            {formatSize(absSize)} {displaySymbol(position.coin)}
            <span className="ml-1.5 text-faint">{formatUsd(sizeUsd)}</span>
          </SummaryRow>
          <SummaryRow label="Entry">{formatPrice(position.entryPx)}</SummaryRow>
          <SummaryRow label="Mid">
            <Price value={mid} className="-mr-1" />
          </SummaryRow>
          <SummaryRow label="Unrealized PnL">
            <span className={signTone(pnl)}>{formatUsd(pnl, { signed: true })}</span>
          </SummaryRow>
        </dl>
      )}
    </div>
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
          <button
            key={preset}
            type="button"
            aria-pressed={percent === preset}
            data-testid={`close-preset-${preset}`}
            onClick={() => onChange(preset)}
            className={cn(
              "h-7 rounded-sm border font-mono text-xs text-muted-foreground transition-colors hover:text-foreground",
              percent === preset && "border-brand/60 bg-brand-dim text-brand hover:text-brand",
            )}
          >
            {preset === 100 ? "All" : `${preset}%`}
          </button>
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
  const closing = position.side === "long" ? "Sell" : "Buy";
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
          <span className={cn("font-sans", position.side === "long" ? "text-short" : "text-long")}>
            {closing} {displaySymbol(position.coin)} perp · reduce-only
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
