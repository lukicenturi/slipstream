"use client";

import { useSyncExternalStore } from "react";

import type { BrowserPermission, Notice } from "@/lib/notifications";
import { NETWORK } from "@/lib/network";
import { noticeTag, noticeText } from "@/lib/notifications";

/*
 * Browser notifications through the Notification API. They fire only while
 * a Slipstream tab is open. Push alerts (hooks/usePushAlerts.ts) cover the
 * time without a tab and use the same tag, so the system merges a duplicate.
 * Every call is in try/catch and never throws.
 */

const listeners = new Set<() => void>();

function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function readPermission(): BrowserPermission {
  if (!isSupported()) return "unsupported";
  try {
    return window.Notification.permission;
  } catch {
    return "unsupported";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // The user can change the permission in the browser while the tab is in the background.
  document.addEventListener("visibilitychange", listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Ask the browser for the permission. Resolves with the new state. */
export async function requestBrowserPermission(): Promise<BrowserPermission> {
  if (!isSupported()) return "unsupported";
  try {
    await window.Notification.requestPermission();
  } catch {
    // An old browser or a blocked prompt. The state below says what happened.
  }
  notify();
  return readPermission();
}

/**
 * Show one browser notification. The caller checks the setting, the
 * permission and the visibility (shouldShowBrowserNotice). A click focuses
 * the tab and opens the trader profile through `navigate` (the router).
 */
export function showBrowserNotice(
  notice: Notice,
  label: string,
  navigate: (href: string) => void,
): void {
  if (readPermission() !== "granted") return;
  try {
    const { title, body } = noticeText(notice, label);
    const notification = new window.Notification(title, {
      body,
      tag: noticeTag(notice, NETWORK),
      icon: "/icons/icon-192.png",
    });
    notification.onclick = () => {
      try {
        window.focus();
        navigate(`/trader/${notice.address}`);
        notification.close();
      } catch {
        // Nothing to do. The notification stays open.
      }
    };
  } catch {
    // Some browsers (Chrome on Android) allow notifications only from a service worker.
  }
}

/** The Notification API state for settings UI. */
export function useBrowserNotifications() {
  const permission = useSyncExternalStore(subscribe, readPermission, () => "default" as const);
  return {
    supported: permission !== "unsupported",
    permission,
    request: requestBrowserPermission,
    show: showBrowserNotice,
  };
}

/** Tell the settings UI to read the permission again (after another prompt). */
export const refreshBrowserPermission = notify;

/** The current permission, read outside React. */
export const browserPermission = readPermission;
