"use client";

import { useSyncExternalStore } from "react";

/*
 * One shared clock for relative times ("12s ago"). A single interval
 * runs while at least one component reads it, so 100 feed rows do not
 * start 100 timers.
 */

const TICK_MS = 10_000;

let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  now = Date.now();
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(notify, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  // Before the first subscribe, start from the current time.
  if (now === 0) now = Date.now();
  return now;
}

// Relative times render only in the browser, after data arrives.
function getServerSnapshot(): number {
  return 0;
}

/** The current time in ms, updated every 10 s for all readers at once. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
