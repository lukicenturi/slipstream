"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  AGENT_STORAGE_PREFIX,
  clearAgent,
  loadAgent,
  saveAgent,
  type StoredAgent,
} from "@/lib/trading/agent";

/*
 * The agent store. One cache per owner and one listener set, so the sheet
 * and the header agree. Storage access is in try/catch (lib/trading/agent).
 * When storage fails, a new agent still works for this session.
 */

const listeners = new Set<() => void>();
const cache = new Map<string, StoredAgent | null>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && !event.key.startsWith(AGENT_STORAGE_PREFIX)) return;
  cache.clear();
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function read(owner: string): StoredAgent | null {
  const key = owner.toLowerCase();
  if (!cache.has(key)) cache.set(key, loadAgent(key));
  return cache.get(key) ?? null;
}

/** Store a newly approved agent. Returns false when only the session holds it. */
export function storeAgent(owner: string, agent: StoredAgent): boolean {
  const saved = saveAgent(owner, agent);
  cache.set(owner.toLowerCase(), agent);
  notify();
  return saved;
}

/** Remove the agent of an owner from this browser. */
export function forgetAgent(owner: string): void {
  clearAgent(owner);
  cache.set(owner.toLowerCase(), null);
  notify();
}

/** The stored agent of the connected owner, or null. */
export function useAgent(owner: string | undefined): StoredAgent | null {
  const getSnapshot = useCallback(() => (owner ? read(owner) : null), [owner]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
