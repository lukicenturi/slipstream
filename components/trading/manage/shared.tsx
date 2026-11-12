"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { SummaryRow } from "@/components/copy-trade/CopyTradeFields";
import { AssetIcon } from "@/components/shared/AssetIcon";
import { Price } from "@/components/shared/Price";
import { Side } from "@/components/shared/Side";
import { signTone } from "@/components/shared/tone";
import { Button } from "@/components/ui/button";
import { displaySymbol } from "@/lib/assets";
import { unrealizedPnl } from "@/lib/calc/positions";
import { formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { OpenOrder, PerpAsset, Position } from "@/lib/hyperliquid/schemas";
import type { ReplaceError } from "@/lib/trading/actions";
import type { StoredAgent } from "@/lib/trading/agent";
import { cn } from "@/lib/utils";

import { PrimaryButton, Spinner } from "../TradingParts";

/*
 * The parts that the three tabs of the manage sheet share: the context the
 * form hands to each tab, the footer portal, the position summary and the
 * small chip and review-row parts.
 */

/** What the form hands to each tab. */
export interface ManageContext {
  id: string;
  coin: string;
  /** The connected owner (lower case), or undefined. */
  owner: string | undefined;
  agent: StoredAgent | null;
  /** 1 wallet, 2 agent, 3 order. */
  step: 1 | 2 | 3;
  /** The live position, or undefined after it closed. */
  position: Position | undefined;
  asset: PerpAsset | null;
  mid: number | undefined;
  /** The reason that blocks every tab (not the owner, closed, markets, price), or null. */
  baseBlock: string | null;
  /** The button of steps 1 and 2 (connect, risk, approve), shown instead of the tab's own. */
  sharedPrimary: ReactNode | null;
  /** The current on-chain TP and SL of the position. */
  tpsl: { tp: OpenOrder | null; sl: OpenOrder | null };
  /** The open orders of the owner (empty before they load). */
  orders: readonly OpenOrder[];
  /** The open orders loaded at least once. */
  ordersReady: boolean;
  /** The footer node that the active tab renders its buttons into. */
  footer: HTMLElement | null;
  /** True for the tab on screen. */
  active: boolean;
  onDone: () => void;
}

/** The buttons of the active tab, in the sheet footer above the agent block. */
export function TabFooter({ ctx, children }: { ctx: ManageContext; children: ReactNode }) {
  if (!ctx.active || !ctx.footer) return null;
  return createPortal(children, ctx.footer);
}

/** The step 3 reason line under the footer button. */
export function BlockReason({ id, testId, text }: { id: string; testId: string; text: string }) {
  return (
    <p id={id} data-testid={testId} className="text-center text-2xs text-muted-foreground">
      {text}
    </p>
  );
}

/** "Back" and the one confirm button, side by side. */
export function ReviewButtons({
  backTestId,
  confirmTestId,
  onBack,
  onConfirm,
  pending,
  disabled,
  describedBy,
  label,
  pendingLabel,
}: {
  backTestId: string;
  confirmTestId: string;
  onBack: () => void;
  onConfirm: () => void;
  pending: boolean;
  disabled: boolean;
  describedBy: string | undefined;
  label: string;
  pendingLabel: string;
}) {
  return (
    <div className="flex w-full gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        data-testid={backTestId}
        className="h-10 w-24 shrink-0 text-sm"
        onClick={onBack}
        disabled={pending}
      >
        Back
      </Button>
      <PrimaryButton
        data-testid={confirmTestId}
        onClick={onConfirm}
        disabled={pending || disabled}
        aria-describedby={describedBy}
        className="h-10 min-w-0 flex-1 text-sm font-semibold"
      >
        {pending ? <Spinner /> : null}
        {pending ? pendingLabel : label}
      </PrimaryButton>
    </div>
  );
}

export const CHIP =
  "h-7 rounded-sm border font-mono text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50";
export const CHIP_ON = "border-brand/60 bg-brand-dim text-brand hover:text-brand";

/** A preset chip with a pressed state. */
export function Chip({
  pressed,
  onClick,
  children,
  testId,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  testId: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className={cn(CHIP, pressed && CHIP_ON)}
    >
      {children}
    </button>
  );
}

/** A small text button (Cancel, Yes, No) inside a row. */
export function TextButton({
  onClick,
  children,
  testId,
  tone = "muted",
  disabled,
  label,
}: {
  onClick: () => void;
  children: ReactNode;
  testId: string;
  tone?: "muted" | "short";
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className={cn(
        "rounded-sm text-2xs underline underline-offset-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        tone === "short" ? "text-short" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The position being managed, with the live mid and unrealized PnL. */
export function PositionSummary({
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

/** "Sell" for a long's closing order, "Buy" for a short's. */
export function closingVerb(position: Pick<Position, "side">): "Sell" | "Buy" {
  return position.side === "long" ? "Sell" : "Buy";
}

/** The tone class of a closing order's side. */
export function closingTone(position: Pick<Position, "side">): string {
  return position.side === "long" ? "text-short" : "text-long";
}

/** The old orders that are still open because their cancel failed. */
export function ReplaceErrors({
  errors,
  testId,
}: {
  errors: readonly ReplaceError[];
  testId: string;
}) {
  if (errors.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {errors.map((error) => (
        <p key={error.oid} role="alert" data-testid={testId} className="text-2xs text-short">
          {error.message}
          {error.exchangeMessage ? (
            <span className="text-muted-foreground"> {error.exchangeMessage}</span>
          ) : null}
        </p>
      ))}
    </div>
  );
}
