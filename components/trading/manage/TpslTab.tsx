"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { LABEL, SummaryRow } from "@/components/copy-trade/CopyTradeFields";
import { signTone } from "@/components/shared/tone";
import { useTrailingConfigs } from "@/hooks/useTrailingStops";
import { useCancelOrders, useSetTpsl, type SetTpslResult } from "@/hooks/useTradingActions";
import { displaySymbol } from "@/lib/assets";
import { formatPercent, formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { OpenOrder, PerpAsset, Position } from "@/lib/hyperliquid/schemas";
import { NETWORK, networkLabel } from "@/lib/trading/config";
import { isCancelDone } from "@/lib/trading/openOrders";
import type { OrderResult } from "@/lib/trading/order";
import {
  buildTriggerOrder,
  levelInputText,
  parsePriceInput,
  pnlAtPrice,
  quickLevels,
  TPSL_MARKET_SLIPPAGE,
  validateTriggerPx,
  type TpslKind,
  type TriggerOrder,
} from "@/lib/trading/tpsl";
import { trailingLabelOids } from "@/lib/trading/trailing";
import { cn } from "@/lib/utils";

import { ErrorNotice, PrimaryButton } from "../TradingParts";
import {
  BlockReason,
  Chip,
  closingTone,
  closingVerb,
  ReplaceErrors,
  ReviewButtons,
  TabFooter,
  TextButton,
  type ManageContext,
} from "./shared";

const KIND_TITLE: Record<TpslKind, string> = { tp: "Take profit", sl: "Stop loss" };
const SLIPPAGE_PCT = `${TPSL_MARKET_SLIPPAGE * 100}%`;

interface Draft {
  kind: TpslKind;
  text: string;
  /** null for an empty input (no change), NaN for a bad value. */
  px: number | null;
  error: string | null;
}

/** The trigger order that a draft sends, or null when it cannot be built. */
function draftOrder(draft: Draft, asset: PerpAsset | null, position: Position | undefined) {
  if (draft.px === null || draft.error || !asset || !position) return null;
  try {
    return buildTriggerOrder({
      assetIndex: asset.index,
      szDecimals: asset.szDecimals,
      positionSide: position.side,
      positionSize: Math.abs(position.size),
      kind: draft.kind,
      triggerPx: draft.px,
    });
  } catch {
    return null;
  }
}

/**
 * Take profit and stop loss: on-chain trigger orders for the whole
 * position (reduce-only, market with a 10 % slippage limit, mark price
 * trigger). An empty input leaves that side as it is. A new order replaces
 * the current one of the same kind: the new order goes out first, and the
 * old one is cancelled once the new one is accepted. One review, one
 * confirm button.
 */
export function TpslTab({ ctx }: { ctx: ManageContext }) {
  const { id, coin, position, asset, mid, step } = ctx;
  const setTpsl = useSetTpsl(ctx.owner, ctx.agent);
  const cancel = useCancelOrders(ctx.owner, ctx.agent);
  const trailing = useTrailingConfigs(ctx.owner);
  const [texts, setTexts] = useState<Record<TpslKind, string>>({ tp: "", sl: "" });
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<SetTpslResult | null>(null);

  function setText(kind: TpslKind, text: string) {
    setTexts((current) => ({ ...current, [kind]: text }));
    setReviewing(false);
  }

  const drafts: Record<TpslKind, Draft> = {
    tp: makeDraft("tp"),
    sl: makeDraft("sl"),
  };
  function makeDraft(kind: TpslKind): Draft {
    const text = texts[kind];
    const px = parsePriceInput(text);
    const error =
      px === null || !position
        ? null
        : validateTriggerPx({ kind, positionSide: position.side, triggerPx: px, mid });
    return { kind, text, px, error };
  }

  const orders: { kind: TpslKind; order: TriggerOrder }[] = [];
  for (const kind of ["tp", "sl"] as const) {
    const order = draftOrder(drafts[kind], asset, position);
    if (order) orders.push({ kind, order });
  }

  let blockReason = ctx.baseBlock;
  const firstError = drafts.tp.error ?? drafts.sl.error;
  // Until the book is known, a confirm could place a second TP or SL next to the current one.
  if (!blockReason && !ctx.ordersReady) blockReason = "Loading open orders.";
  else if (!blockReason && firstError) blockReason = firstError;
  else if (!blockReason && drafts.tp.px === null && drafts.sl.px === null)
    blockReason = "Enter a take profit or a stop loss price.";
  else if (!blockReason && orders.length === 0) blockReason = "These orders cannot be built.";

  function onConfirm() {
    if (!asset || !position || blockReason) return;
    setResult(null);
    const tp = drafts.tp.px ?? undefined;
    const sl = drafts.sl.px ?? undefined;
    setTpsl.mutate(
      {
        asset,
        position,
        tp,
        sl,
        replace: { tpOid: ctx.tpsl.tp?.oid, slOid: ctx.tpsl.sl?.oid },
      },
      {
        onSuccess: (outcome) => {
          setResult(outcome);
          const placed = (["tp", "sl"] as const).filter(
            (kind) => outcome[kind]?.kind === "resting",
          );
          if (placed.length > 0) {
            toast(
              `${placed.map((kind) => KIND_TITLE[kind]).join(" and ")} set for ${displaySymbol(coin)} on ${NETWORK}`,
            );
            setTexts((current) => ({
              tp: placed.includes("tp") ? "" : current.tp,
              sl: placed.includes("sl") ? "" : current.sl,
            }));
          }
        },
        onSettled: () => setReviewing(false),
      },
    );
  }

  function onCancelOrder(order: OpenOrder) {
    if (!asset) return;
    cancel.mutate({ coin, assetIndex: asset.index, oids: [order.oid] });
  }

  // "Already canceled, or filled" is done, not a failure.
  const cancelFailures = (cancel.data?.statuses ?? []).flatMap((status) =>
    status.kind === "error" && !isCancelDone(status) ? [status.message] : [],
  );
  const showReview = step === 3 && reviewing && orders.length > 0 && blockReason === null;
  const reasonId = `${id}-tpsl-reason`;
  // The live tracked stop: after a move it can have a new oid until a reconcile adopts it.
  const trailingOids = trailingLabelOids(trailing, ctx.orders);

  let primary: ReactNode;
  if (ctx.sharedPrimary) primary = ctx.sharedPrimary;
  else if (!showReview) {
    primary = (
      <PrimaryButton
        data-testid="review-tpsl"
        onClick={() => {
          setTpsl.reset();
          setResult(null);
          setReviewing(true);
        }}
        disabled={blockReason !== null}
        aria-describedby={blockReason ? reasonId : undefined}
      >
        Review TP / SL
      </PrimaryButton>
    );
  } else {
    primary = (
      <ReviewButtons
        backTestId="tpsl-review-back"
        confirmTestId="confirm-tpsl"
        onBack={() => setReviewing(false)}
        onConfirm={onConfirm}
        pending={setTpsl.isPending}
        disabled={blockReason !== null}
        describedBy={blockReason ? reasonId : undefined}
        label={`Set TP / SL on ${NETWORK}`}
        pendingLabel="Sending…"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {position
        ? (["tp", "sl"] as const).map((kind) => (
            <TriggerRow
              key={kind}
              id={id}
              kind={kind}
              draft={drafts[kind]}
              onText={(text) => setText(kind, text)}
              position={position}
              szDecimals={asset?.szDecimals}
              current={ctx.tpsl[kind]}
              ordersReady={ctx.ordersReady}
              isTrailing={(order) => trailingOids.has(order.oid)}
              canCancel={step === 3 && asset !== null}
              cancelPending={cancel.isPending}
              onCancel={onCancelOrder}
            />
          ))
        : null}

      {showReview && position ? (
        <TpslReviewCard
          position={position}
          orders={orders}
          current={ctx.tpsl}
          isTrailing={(order) => trailingOids.has(order.oid)}
        />
      ) : null}

      {setTpsl.error ? <ErrorNotice error={setTpsl.error} /> : null}
      {cancel.error ? <ErrorNotice error={cancel.error} /> : null}
      {cancelFailures.length > 0 ? (
        <p role="alert" data-testid="tpsl-cancel-result" className="text-2xs text-short">
          {cancelFailures.join(" ")}
        </p>
      ) : null}
      {result ? <TpslResult result={result} /> : null}
      {result ? <ReplaceErrors errors={result.replaceErrors} testId="tpsl-replace-error" /> : null}

      <TabFooter ctx={ctx}>
        {primary}
        {step === 3 && blockReason ? (
          <BlockReason id={reasonId} testId="tpsl-block-reason" text={blockReason} />
        ) : null}
      </TabFooter>
    </div>
  );
}

/** One side (take profit or stop loss): the current order, the input, quick levels and PnL. */
function TriggerRow({
  id,
  kind,
  draft,
  onText,
  position,
  szDecimals,
  current,
  ordersReady,
  isTrailing,
  canCancel,
  cancelPending,
  onCancel,
}: {
  id: string;
  kind: TpslKind;
  draft: Draft;
  onText: (text: string) => void;
  position: Position;
  szDecimals: number | undefined;
  current: OpenOrder | null;
  ordersReady: boolean;
  isTrailing: (order: OpenOrder) => boolean;
  canCancel: boolean;
  cancelPending: boolean;
  onCancel: (order: OpenOrder) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const inputId = `${id}-${kind}-input`;
  const levels = quickLevels(kind, position.side, position.entryPx, szDecimals);
  const pnl =
    draft.px !== null && !Number.isNaN(draft.px) && !draft.error
      ? pnlAtPrice(position, draft.px)
      : null;
  const title = KIND_TITLE[kind];

  return (
    <div data-testid={`${kind}-row`} className="rounded-md border bg-surface px-3 pt-2.5 pb-3">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className={LABEL}>
          {title}
        </label>
        <span className="text-2xs text-faint">Trigger price</span>
      </div>

      <div
        data-testid={`${kind}-current`}
        className="mt-1 flex min-h-5 items-center gap-2 text-2xs"
      >
        {!ordersReady ? (
          <span className="text-faint">Loading open orders…</span>
        ) : current ? (
          <>
            <span className="text-muted-foreground">On-chain</span>
            <span className="font-mono text-foreground">
              {current.triggerPx === null ? "—" : formatPrice(current.triggerPx)}
            </span>
            <span className="text-faint">
              {isTrailing(current)
                ? "trailing stop"
                : current.isPositionTpsl
                  ? "position TP/SL"
                  : `${formatSize(current.sz)} ${displaySymbol(current.coin)}`}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {confirming ? (
                <>
                  <span className="text-muted-foreground">Cancel it?</span>
                  <TextButton
                    testId={`${kind}-cancel-confirm`}
                    tone="short"
                    disabled={cancelPending}
                    onClick={() => {
                      setConfirming(false);
                      onCancel(current);
                    }}
                  >
                    Yes, cancel
                  </TextButton>
                  <TextButton testId={`${kind}-cancel-back`} onClick={() => setConfirming(false)}>
                    No
                  </TextButton>
                </>
              ) : (
                <TextButton
                  testId={`${kind}-cancel`}
                  disabled={!canCancel || cancelPending}
                  label={`Cancel the ${title.toLowerCase()} at ${current.triggerPx === null ? "an unknown price" : formatPrice(current.triggerPx)}`}
                  onClick={() => setConfirming(true)}
                >
                  Cancel
                </TextButton>
              )}
            </span>
          </>
        ) : (
          <span className="text-faint">None set</span>
        )}
      </div>

      <input
        id={inputId}
        data-testid={`${kind}-input`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={current ? "New price, or leave empty" : "Price, or leave empty"}
        value={draft.text}
        onChange={(event) => onText(event.target.value)}
        aria-invalid={draft.error ? true : undefined}
        aria-describedby={`${inputId}-hint`}
        className="mt-2 h-8 w-full min-w-0 rounded-sm border bg-background px-2 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-xs placeholder:text-faint aria-invalid:border-short/60"
      />

      <div
        role="group"
        aria-label={`${title} quick levels`}
        className="mt-2 grid grid-cols-4 gap-1"
      >
        {levels.map((level) => (
          <Chip
            key={level.pct}
            pressed={draft.px === level.px}
            testId={`${kind}-level-${level.pct}`}
            label={`${title} ${level.label} from entry, ${formatPrice(level.px)}`}
            onClick={() => onText(levelInputText(level.px, szDecimals))}
          >
            {level.label}
          </Chip>
        ))}
      </div>

      <p id={`${inputId}-hint`} className="mt-2 font-mono text-2xs">
        {draft.error ? (
          <span data-testid={`${kind}-error`} className="font-sans text-short">
            {draft.error}
          </span>
        ) : pnl ? (
          <span data-testid={`${kind}-pnl`} className="text-muted-foreground">
            <span className="font-sans">Est. PnL at trigger</span>{" "}
            <span className={signTone(pnl.pnl)}>
              {formatUsd(pnl.pnl, { signed: true })} ({formatPercent(pnl.roe, { signed: true })})
            </span>
          </span>
        ) : (
          <span className="font-sans text-faint">
            {current ? "Empty keeps the current order." : "Empty sets no order."}
          </span>
        )}
      </p>
    </div>
  );
}

/** The review: each order that goes out, and the old orders cancelled after them. */
function TpslReviewCard({
  position,
  orders,
  current,
  isTrailing,
}: {
  position: Position;
  orders: { kind: TpslKind; order: TriggerOrder }[];
  current: { tp: OpenOrder | null; sl: OpenOrder | null };
  isTrailing: (order: OpenOrder) => boolean;
}) {
  const symbol = displaySymbol(position.coin);
  const replaced = orders.flatMap(({ kind }) => {
    const order = current[kind];
    return order ? [{ kind, order }] : [];
  });
  // Replacing the trailing stop ends its trailing: say so in the "Then cancels" list.
  const endsTrailing = replaced.some(({ kind, order }) => kind === "sl" && isTrailing(order));
  return (
    <div data-testid="tpsl-review-card" className="flex flex-col gap-2">
      <dl className="divide-y rounded-md border border-brand/40">
        <SummaryRow label="Network">
          <span className="font-sans font-medium text-brand">
            {networkLabel(NETWORK)}
            {NETWORK === "mainnet" ? " · real funds" : " · test funds"}
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
        {orders.map(({ kind, order }) => (
          <SummaryRow
            key={kind}
            testId={`tpsl-review-order-${kind}`}
            label={
              <span className={cn("font-sans", closingTone(position))}>
                {KIND_TITLE[kind]} · {closingVerb(position)}
              </span>
            }
          >
            {formatPrice(Number(order.t.trigger.triggerPx))}
            <span className="ml-1.5 text-2xs text-faint">limit {formatPrice(Number(order.p))}</span>
          </SummaryRow>
        ))}
        {replaced.map(({ kind, order }) => (
          <SummaryRow
            key={`cancel-${kind}`}
            testId={`tpsl-review-cancel-${kind}`}
            label={<span className="font-sans">Then cancels</span>}
          >
            <span className="font-sans text-muted-foreground">
              {KIND_TITLE[kind]} at{" "}
              <span className="font-mono text-foreground">
                {order.triggerPx === null ? "—" : formatPrice(order.triggerPx)}
              </span>
            </span>
          </SummaryRow>
        ))}
        {endsTrailing ? (
          <SummaryRow
            testId="tpsl-review-ends-trailing"
            label={<span className="font-sans">Then cancels</span>}
          >
            <span className="font-sans text-muted-foreground">Ends the trailing stop</span>
          </SummaryRow>
        ) : null}
      </dl>
      <p className="text-2xs text-muted-foreground">
        Reduce-only trigger orders on {symbol}, for the whole position. Each one triggers on the
        mark price and sends a market order with a {SLIPPAGE_PCT} slippage limit. They can only
        close this position.
        {replaced.length > 0
          ? " The new orders go out first; the old ones are cancelled only after the exchange accepts the new ones."
          : null}
      </p>
    </div>
  );
}

/** The outcome of each order after the request. */
function TpslResult({ result }: { result: SetTpslResult }) {
  const lines = (["tp", "sl"] as const).flatMap((kind) => {
    const outcome: OrderResult | undefined = result[kind];
    return outcome ? [{ kind, outcome }] : [];
  });
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map(({ kind, outcome }) => (
        <p
          key={kind}
          role={outcome.kind === "error" ? "alert" : "status"}
          data-testid={`tpsl-result-${kind}`}
          data-kind={outcome.kind}
          className={cn("text-2xs", outcome.kind === "error" ? "text-short" : "text-foreground")}
        >
          {KIND_TITLE[kind]}:{" "}
          {outcome.kind === "resting"
            ? `set on-chain (oid ${outcome.oid}).`
            : outcome.kind === "filled"
              ? `filled ${formatSize(outcome.totalSz)} at ${formatPrice(outcome.avgPx)}.`
              : outcome.message}
        </p>
      ))}
    </div>
  );
}
