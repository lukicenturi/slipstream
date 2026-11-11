"use client";

import { useSyncExternalStore } from "react";

import {
  addNotices,
  clearNotices,
  markAllRead as markAllReadPure,
  markRead as markReadPure,
  NOTIFICATIONS_STORAGE_KEY,
  parseNotices,
  unreadCount,
  type Notice,
} from "@/lib/notifications";

import { createLocalStore } from "./createLocalStore";

const NO_NOTICES: readonly Notice[] = [];

/** The notice list store (`slipstream.notifications`), newest first, at most 50. */
export const noticesStore = createLocalStore<readonly Notice[]>(
  NOTIFICATIONS_STORAGE_KEY,
  parseNotices,
  NO_NOTICES,
);

function push(notices: readonly Notice[]): void {
  if (notices.length === 0) return;
  noticesStore.update((current) => addNotices(current, notices));
}

function markAllRead(): void {
  noticesStore.update((current) =>
    unreadCount(current) === 0 ? current : markAllReadPure(current),
  );
}

function markRead(id: string): void {
  noticesStore.update((current) =>
    current.some((notice) => notice.id === id && !notice.read)
      ? markReadPure(current, id)
      : current,
  );
}

function clear(): void {
  noticesStore.update((current) => (current.length === 0 ? current : clearNotices()));
}

/** The notices of watched traders, the unread count, and helpers. */
export function useNotifications() {
  const notices = useSyncExternalStore(
    noticesStore.subscribe,
    noticesStore.getSnapshot,
    noticesStore.getServerSnapshot,
  );
  return { notices, unread: unreadCount(notices), markAllRead, markRead, clear, push };
}

/** Add notices from outside React (the tracker). */
export const pushNotices = push;
