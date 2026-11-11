"use client";

import { useEffect, useEffectEvent } from "react";

import {
  getHyperliquidSocket,
  subscriptionKey,
  type MessageFor,
  type Subscription,
} from "@/lib/hyperliquid/ws";

/**
 * Subscribe to one channel on the shared socket while the component is
 * mounted. Pass null to skip. The handler can change on every render
 * without a resubscribe; only a change of the subscription key resubscribes.
 */
export function useHyperliquidWs<S extends Subscription>(
  subscription: S | null,
  handler: (message: MessageFor<S>) => void,
): void {
  const key = subscription ? subscriptionKey(subscription) : null;
  const onMessage = useEffectEvent((message: MessageFor<S>) => handler(message));
  const currentSubscription = useEffectEvent(() => subscription);

  useEffect(() => {
    if (key === null) return;
    const socket = getHyperliquidSocket();
    const latest = currentSubscription();
    if (!socket || !latest) return;
    return socket.subscribe(latest, (message) => onMessage(message));
  }, [key]);
}
