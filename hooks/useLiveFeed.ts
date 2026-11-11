"use client";

import { useEffect, useReducer } from "react";

import { initialLiveFeedState, liveFeedReducer, type LiveFeedState } from "@/lib/calc/liveFeed";
import { getHyperliquidSocket } from "@/lib/hyperliquid/ws";

/**
 * Live fills of the given traders, aggregated per order, newest first.
 * Every subscription goes through the shared socket. The reducer drops
 * fills that it already has, so the snapshot replay after a reconnect
 * adds nothing twice.
 */
export function useLiveFeed(addresses: readonly string[]): LiveFeedState {
  const [state, dispatch] = useReducer(liveFeedReducer, initialLiveFeedState);
  // A stable key, so a new array with the same addresses does not resubscribe.
  const key = addresses.map((address) => address.toLowerCase()).join(",");

  useEffect(() => {
    const socket = getHyperliquidSocket();
    if (!socket || key === "") return;
    const unsubscribes = key
      .split(",")
      .map((user) =>
        socket.subscribe({ type: "userFills", user }, (message) =>
          dispatch({ type: "message", message }),
        ),
      );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [key]);

  return state;
}
