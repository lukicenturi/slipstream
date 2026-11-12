import { z } from "zod";

import type { OpenOrder } from "@/lib/hyperliquid/schemas";

import { classifyOpenOrder } from "./tpsl";

/*
 * Pure helpers for open orders: the cancel and modify responses of the
 * exchange, the type label of an order, and the coin groups of the panel.
 */

const cancelStatusSchema = z.union([z.literal("success"), z.object({ error: z.string() })]);

/** The body of a cancel request (`statuses` holds one entry per cancelled order). */
export const cancelResponseSchema = z.object({
  status: z.literal("ok"),
  response: z.object({
    type: z.literal("cancel"),
    data: z.object({ statuses: z.array(cancelStatusSchema) }),
  }),
});

/** The body of a modify request. */
export const modifyResponseSchema = z.union([
  z.object({ status: z.literal("ok"), response: z.object({ type: z.literal("default") }) }),
  z.object({ status: z.literal("err"), response: z.string() }),
]);

export type CancelStatus = { kind: "success" } | { kind: "error"; message: string };

/** The status of each cancelled order, or null when the body is not a cancel response. */
export function summarizeCancel(body: unknown): CancelStatus[] | null {
  const parsed = cancelResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.response.data.statuses.map((status) =>
    status === "success" ? { kind: "success" } : { kind: "error", message: status.error },
  );
}

/**
 * True when an exchange text says that the order is no longer open (it
 * filled or was cancelled). The agent text "User or API Wallet … does not
 * exist" is not about an order, so it does not count.
 */
export function isOrderGoneMessage(text: string | undefined): boolean {
  if (!text || /user or api wallet/i.test(text)) return false;
  return /never placed|already cancel|cancel+ed or filled|filled or cancel|order (was )?not found|order does not exist|unknown oid/i.test(
    text,
  );
}

/**
 * True when a cancel status means that the order is no longer open: a
 * success, or the exchange's "never placed, already canceled, or filled".
 */
export function isCancelDone(status: CancelStatus | undefined): boolean {
  if (!status) return false;
  return status.kind === "success" || isOrderGoneMessage(status.message);
}

/** A short type label. A stop whose oid is a trailing stop of this browser reads "Trailing stop". */
export function orderTypeLabel(order: OpenOrder, trailingOids: ReadonlySet<number>): string {
  const { kind } = classifyOpenOrder(order);
  if (kind === "sl" && trailingOids.has(order.oid)) return "Trailing stop";
  if (kind === "tp") return "Take profit";
  if (kind === "sl") return "Stop loss";
  if (kind === "limit") return "Limit";
  return order.orderType;
}

/** The price to show: the trigger price of a trigger order, else the limit price. */
export function orderDisplayPx(order: OpenOrder): number {
  return order.triggerPx ?? order.limitPx;
}

export interface OpenOrderGroup {
  coin: string;
  orders: OpenOrder[];
}

/** Orders grouped by coin: coins A to Z, newest order first in each coin. */
export function groupOrdersByCoin(orders: readonly OpenOrder[]): OpenOrderGroup[] {
  const groups = new Map<string, OpenOrder[]>();
  for (const order of orders) {
    const list = groups.get(order.coin) ?? [];
    list.push(order);
    groups.set(order.coin, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([coin, list]) => ({ coin, orders: list.sort((a, b) => b.timestamp - a.timestamp) }));
}
