"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";

import { alertSettingsStore } from "@/hooks/useAlertSettings";
import { browserPermission, showBrowserNotice } from "@/hooks/useBrowserNotifications";
import { recordLastTrades } from "@/hooks/useLastTrades";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import { useTraderLabels } from "@/hooks/useNames";
import { pushNotices } from "@/hooks/useNotifications";
import { useWatchlist } from "@/hooks/useWatchlist";
import { shouldNotify } from "@/lib/alerts";
import type { FeedItem } from "@/lib/calc/aggregateFills";
import {
  burstText,
  collapseBurst,
  INITIAL_BURST_STATE,
  noticeFromFeedItem,
  noticeText,
  shouldShowBrowserNotice,
  type BurstState,
  type Notice,
} from "@/lib/notifications";

const BURST_TOAST_ID = "watchlist-burst";

declare global {
  interface Window {
    /** Development only: feed fake live items through the tracker (browser checks). */
    __slipstreamTracker?: { injectLive: (items: FeedItem[]) => void };
  }
}

/**
 * Watches the live fills of every followed trader while the app is open.
 * It subscribes through useLiveFeed (the shared socket), so a trader who is
 * also in the home feed costs one subscription. New live orders become
 * notices, toasts (with burst collapsing) and, when the tab is hidden,
 * browser notifications. Snapshot items never notify. Renders nothing.
 */
export function WatchlistTracker() {
  const router = useRouter();
  const { addresses } = useWatchlist();
  const feed = useLiveFeed(addresses);
  const label = useTraderLabels(addresses);

  /** Feed item id -> the fill count when the tracker last handled it. */
  const handled = useRef(new Map<string, number>());
  /** Ids that already produced a toast. Later parts only update the notice. */
  const notified = useRef(new Set<string>());
  const burst = useRef<BurstState>(INITIAL_BURST_STATE);

  const handleItems = useEffectEvent((items: readonly FeedItem[]) => {
    function showToasts(fresh: readonly Notice[]) {
      const decision = collapseBurst(fresh, burst.current, Date.now());
      burst.current = decision.state;
      if (decision.kind === "summary") {
        toast(burstText(decision.count), {
          id: BURST_TOAST_ID,
          action: { label: "View", onClick: () => router.push("/watchlist") },
        });
        return;
      }
      for (const notice of decision.notices) {
        const { title, body } = noticeText(notice, label(notice.address).label);
        toast(title, {
          id: notice.id,
          description: body,
          action: { label: "View", onClick: () => router.push(`/trader/${notice.address}`) },
        });
      }
    }

    recordLastTrades(items);
    const settings = alertSettingsStore.getSnapshot();
    const fresh: Notice[] = [];
    const updates: Notice[] = [];
    for (const item of items) {
      if (!item.live) continue;
      if (handled.current.get(item.id) === item.fillCount) continue;
      handled.current.set(item.id, item.fillCount);
      if (!shouldNotify({ item, settings, watched: addresses })) continue;
      const notice = noticeFromFeedItem(item);
      if (notified.current.has(item.id)) {
        updates.push(notice);
      } else {
        notified.current.add(item.id);
        fresh.push(notice);
      }
    }
    pushNotices([...fresh, ...updates]);
    if (fresh.length === 0) return;

    if (settings.global.toasts) showToasts(fresh);
    if (
      shouldShowBrowserNotice({
        enabled: settings.global.browser,
        permission: browserPermission(),
        visibility: document.visibilityState,
      })
    ) {
      for (const notice of fresh) {
        showBrowserNotice(notice, label(notice.address).label, (href) => router.push(href));
      }
    }
  });

  useEffect(() => {
    handleItems(feed.items);
    // Forget items that left the feed, so the maps stay small.
    if (handled.current.size > feed.items.length * 2) {
      const ids = new Set(feed.items.map((item) => item.id));
      for (const id of handled.current.keys()) if (!ids.has(id)) handled.current.delete(id);
      for (const id of notified.current) if (!ids.has(id)) notified.current.delete(id);
    }
  }, [feed.items]);

  // A development hook for the browser checks (burst collapsing). Removed from production builds.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    window.__slipstreamTracker = { injectLive: (items) => handleItems(items) };
    return () => {
      delete window.__slipstreamTracker;
    };
  }, []);

  return null;
}
