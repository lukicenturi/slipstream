"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { useAlertSettings } from "@/hooks/useAlertSettings";
import { useTraderLabels } from "@/hooks/useNames";
import { pushStateStore, setPushInputs, syncPush } from "@/hooks/usePushAlerts";
import { useWatchlist } from "@/hooks/useWatchlist";
import { PUSH_CONFIGURED } from "@/lib/push";

const SYNC_DELAY_MS = 1_000;

/**
 * Keeps the push Worker in step with this browser: when push is on and the
 * watchlist, the per-trader switches, the minimum size or the labels change,
 * it sends them again (after 1 s, and only when they differ). It also opens
 * the page of a notification click that the service worker passes on.
 * Renders nothing; mounted once in the providers.
 */
export function PushSync() {
  const router = useRouter();
  const { addresses } = useWatchlist();
  const { settings } = useAlertSettings();
  const labels = useTraderLabels(addresses);
  const enabled = useSyncExternalStore(
    pushStateStore.subscribe,
    () => pushStateStore.getSnapshot().enabled,
    () => false,
  );
  const perAddress = settings.perAddress;
  const minNotionalUsd = settings.global.minNotionalUsd;

  useEffect(() => {
    setPushInputs({ watchlist: addresses, perAddress, minNotionalUsd, labels });
    if (!PUSH_CONFIGURED || !enabled) return;
    const timer = window.setTimeout(() => void syncPush(), SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [addresses, perAddress, minNotionalUsd, labels, enabled]);

  useEffect(() => {
    if (!PUSH_CONFIGURED || !("serviceWorker" in navigator)) return;
    function onMessage(event: MessageEvent) {
      const data: unknown = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "type" in data &&
        data.type === "slipstream:navigate" &&
        "url" in data &&
        typeof data.url === "string" &&
        data.url.startsWith("/") &&
        !data.url.startsWith("//")
      ) {
        router.push(data.url);
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
