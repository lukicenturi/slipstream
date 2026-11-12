"use client";

import { XIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { RelativeTime } from "@/components/feed/RelativeTime";
import { AssetIcon } from "@/components/shared/AssetIcon";
import { Panel } from "@/components/shared/Panel";
import { Side } from "@/components/shared/Side";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import { TextButton } from "@/components/trading/manage/shared";
import { ErrorNotice } from "@/components/trading/TradingParts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgent } from "@/hooks/useAgent";
import { useConnectedAddress } from "@/hooks/useConnectedAddress";
import { useOpenOrders } from "@/hooks/useOpenOrders";
import { useTrailingConfigs } from "@/hooks/useTrailingStops";
import { useTradingMeta } from "@/hooks/useTradingMeta";
import { useCancelOrders } from "@/hooks/useTradingActions";
import { displaySymbol } from "@/lib/assets";
import { formatPrice, formatSize } from "@/lib/format";
import type { OpenOrder } from "@/lib/hyperliquid/schemas";
import { NETWORK } from "@/lib/trading/config";
import {
  groupOrdersByCoin,
  isCancelDone,
  orderDisplayPx,
  orderTypeLabel,
} from "@/lib/trading/openOrders";
import { findAsset } from "@/lib/trading/order";
import { trailingLabelOids } from "@/lib/trading/trailing";
import { cn } from "@/lib/utils";

const CELL = "px-3 text-right font-mono text-xs whitespace-nowrap";
const COLUMNS = ["Type", "Side", "Size", "Price", "Reduce-only", "Placed"] as const;

type Confirm = { kind: "order"; oid: number } | { kind: "coin"; coin: string } | null;

/** "0.005 / 0.01", or "Position" for a position TP/SL (size 0 on the book). */
function sizeText(order: OpenOrder): string {
  if (order.isPositionTpsl && order.sz === 0) return "Position";
  if (order.sz === order.origSz) return formatSize(order.sz);
  return `${formatSize(order.sz)} / ${formatSize(order.origSz)}`;
}

/**
 * The open orders of your account on the main perp exchange (trading
 * builds only): limit, take profit, stop loss and trailing stops, with a
 * Cancel per order (inline confirm) and "Cancel all" per coin with 2 or
 * more orders. It signs cancels with the agent, so it loads in its own
 * chunk. Builder exchanges are out of scope: the list reads the main
 * exchange only.
 */
export default function OpenOrdersPanel({
  owner,
  className,
}: {
  /** The lower-case address of the account. */
  owner: string;
  className?: string;
}) {
  const connected = useConnectedAddress();
  const agent = useAgent(connected);
  const orders = useOpenOrders(owner);
  const meta = useTradingMeta();
  const trailing = useTrailingConfigs(owner);
  const cancel = useCancelOrders(connected, agent);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pendingOids, setPendingOids] = useState<ReadonlySet<number>>(new Set());

  const canSign = connected === owner && agent !== null;
  // The live tracked stop: after a move it can have a new oid until a reconcile adopts it.
  const trailingOids = trailingLabelOids(trailing, orders.data ?? []);
  const groups = orders.data ? groupOrdersByCoin(orders.data) : [];
  const count = orders.data?.length ?? 0;

  function onCancel(coin: string, oids: number[]) {
    setConfirm(null);
    const asset = meta.data ? findAsset(meta.data, coin) : null;
    if (!asset) {
      toast(`${displaySymbol(coin)} is not listed on ${NETWORK}; cancel it on Hyperliquid.`);
      return;
    }
    setPendingOids((current) => new Set([...current, ...oids]));
    cancel.mutate(
      { coin, assetIndex: asset.index, oids },
      {
        // The hook shows its own toast for an extra cancel of a trailing stop that failed.
        onSuccess: ({ statuses }) => {
          // "Already canceled, or filled" counts as done: the order is no longer open.
          const failed = oids.flatMap((_, index) => {
            const status = statuses[index];
            if (isCancelDone(status)) return [];
            return [status?.kind === "error" ? status.message : "No status for this order."];
          });
          const done = oids.length - failed.length;
          toast(
            failed.length > 0
              ? `${done} of ${oids.length} ${displaySymbol(coin)} orders cancelled. ${failed[0]}`
              : `${oids.length === 1 ? "Order" : `${oids.length} orders`} cancelled on ${displaySymbol(coin)}`,
          );
        },
        onSettled: () =>
          setPendingOids((current) => {
            const next = new Set(current);
            oids.forEach((oid) => next.delete(oid));
            return next;
          }),
      },
    );
  }

  let body: React.ReactNode;
  if (orders.status === "error") {
    body = (
      <ErrorState
        title="Open orders did not load"
        description="The Hyperliquid info service did not answer."
        onRetry={() => void orders.refetch()}
      />
    );
  } else if (orders.status === "pending") {
    body = <SkeletonRows rows={2} label="Loading open orders" />;
  } else if (count === 0) {
    body = (
      <EmptyState
        title="No open orders"
        description="Take profit, stop loss and limit orders on the main exchange show here."
      />
    );
  } else {
    body = (
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <caption className="sr-only">Open orders on the main perp exchange.</caption>
          <thead>
            <tr className="h-8 border-b text-2xs tracking-wide text-muted-foreground uppercase">
              <th
                scope="col"
                className="sticky left-0 z-[1] bg-background px-3 text-left font-normal max-md:border-r"
              >
                Coin
              </th>
              {COLUMNS.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className={cn(
                    "px-3 font-normal whitespace-nowrap",
                    label === "Type" || label === "Side" ? "text-left" : "text-right",
                  )}
                >
                  {label === "Reduce-only" ? (
                    <>
                      <span aria-hidden="true">RO</span>
                      <span className="sr-only">Reduce-only</span>
                    </>
                  ) : (
                    label
                  )}
                </th>
              ))}
              <th scope="col" className="px-3 text-right font-normal">
                <span className="sr-only">Cancel</span>
              </th>
            </tr>
          </thead>
          <tbody data-testid="open-orders-rows">
            {groups.map((group) => {
              const builder = group.coin.includes(":");
              const symbol = displaySymbol(group.coin);
              const groupOids = group.orders.map((order) => order.oid);
              const groupPending = groupOids.some((oid) => pendingOids.has(oid));
              return (
                <Fragment key={group.coin}>
                  {group.orders.length >= 2 ? (
                    <tr
                      data-testid="open-orders-group"
                      data-coin={group.coin}
                      className="h-8 border-b bg-surface"
                    >
                      <td colSpan={COLUMNS.length + 2} className="px-3">
                        <div className="sticky left-3 inline-flex items-center gap-2 text-2xs">
                          <span className="font-medium text-foreground">{symbol}</span>
                          <span className="text-faint">{group.orders.length} orders</span>
                          {confirm?.kind === "coin" && confirm.coin === group.coin ? (
                            <>
                              <span className="text-muted-foreground">
                                Cancel all {group.orders.length}?
                              </span>
                              <TextButton
                                testId={`cancel-all-confirm-${group.coin}`}
                                tone="short"
                                onClick={() => onCancel(group.coin, groupOids)}
                              >
                                Yes, cancel all
                              </TextButton>
                              <TextButton
                                testId={`cancel-all-back-${group.coin}`}
                                onClick={() => setConfirm(null)}
                              >
                                No
                              </TextButton>
                            </>
                          ) : (
                            <TextButton
                              testId={`cancel-all-${group.coin}`}
                              disabled={!canSign || builder || groupPending}
                              onClick={() => setConfirm({ kind: "coin", coin: group.coin })}
                            >
                              Cancel all {symbol}
                            </TextButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {group.orders.map((order) => (
                    <OrderRow
                      key={order.oid}
                      order={order}
                      label={orderTypeLabel(order, trailingOids)}
                      builder={builder}
                      canSign={canSign}
                      pending={pendingOids.has(order.oid)}
                      confirming={confirm?.kind === "order" && confirm.oid === order.oid}
                      onAsk={() => setConfirm({ kind: "order", oid: order.oid })}
                      onBack={() => setConfirm(null)}
                      onConfirm={() => onCancel(order.coin, [order.oid])}
                    />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Panel
      title="Open orders"
      titleId="open-orders-title"
      titleOnMobile
      meta={orders.status === "success" ? `${count} open` : null}
      className={className}
    >
      <div data-testid="open-orders-panel">
        {count > 0 && !canSign ? (
          <p
            data-testid="open-orders-no-agent"
            className="border-b px-3 py-2 text-2xs text-muted-foreground"
          >
            To cancel here, approve a Slipstream agent: open Manage on one of your positions.
          </p>
        ) : null}
        {cancel.error ? (
          <div className="border-b px-3 py-2">
            <ErrorNotice error={cancel.error} />
          </div>
        ) : null}
        {body}
      </div>
    </Panel>
  );
}

function OrderRow({
  order,
  label,
  builder,
  canSign,
  pending,
  confirming,
  onAsk,
  onBack,
  onConfirm,
}: {
  order: OpenOrder;
  label: string;
  builder: boolean;
  canSign: boolean;
  pending: boolean;
  confirming: boolean;
  onAsk: () => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const symbol = displaySymbol(order.coin);
  const px = orderDisplayPx(order);
  const disabledTitle = builder
    ? "Builder exchange: cancel it on Hyperliquid"
    : !canSign
      ? "Approve a Slipstream agent first"
      : undefined;
  return (
    <tr
      data-testid="open-order-row"
      data-oid={order.oid}
      data-coin={order.coin}
      className="group h-9 border-b transition-colors hover:bg-surface-hover"
    >
      <th
        scope="row"
        className="sticky left-0 z-[1] bg-background px-3 text-left text-xs font-medium whitespace-nowrap text-foreground transition-colors group-hover:bg-surface-hover max-md:border-r"
      >
        <span className="inline-flex items-center gap-1.5" title={order.coin}>
          <AssetIcon coin={order.coin} />
          {symbol}
        </span>
      </th>
      <td
        data-testid="open-order-type"
        className="px-3 text-left text-xs whitespace-nowrap text-foreground"
      >
        {label}
      </td>
      <td className="px-3">
        <Side
          label={order.side === "buy" ? "Buy" : "Sell"}
          tone={order.side === "buy" ? "long" : "short"}
        />
      </td>
      <td className={cn(CELL, "text-foreground")}>{sizeText(order)}</td>
      <td
        className={cn(CELL, "text-foreground")}
        title={
          order.isTrigger
            ? `${order.triggerCondition}, limit ${formatPrice(order.limitPx)}`
            : undefined
        }
      >
        {formatPrice(px)}
      </td>
      <td className="px-3 text-right">
        {order.reduceOnly ? (
          <Badge
            variant="outline"
            className="h-4 px-1 font-mono text-[10px] leading-none"
            title="Reduce-only"
          >
            RO
          </Badge>
        ) : (
          <span className="sr-only">No</span>
        )}
      </td>
      <td className={cn(CELL, "font-sans text-muted-foreground")}>
        <RelativeTime time={order.timestamp} />
      </td>
      <td className="px-3 text-right whitespace-nowrap">
        {confirming ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-2xs text-muted-foreground">Cancel?</span>
            <TextButton testId="open-order-cancel-confirm" tone="short" onClick={onConfirm}>
              Yes
            </TextButton>
            <TextButton testId="open-order-cancel-back" onClick={onBack}>
              No
            </TextButton>
          </span>
        ) : (
          <span title={disabledTitle} className="inline-flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-testid="open-order-cancel"
              disabled={builder || !canSign || pending}
              onClick={onAsk}
              aria-label={`Cancel ${label.toLowerCase()} ${symbol} at ${formatPrice(px)}`}
              className="hover:text-short"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </span>
        )}
      </td>
    </tr>
  );
}
