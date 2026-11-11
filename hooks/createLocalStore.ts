"use client";

/*
 * A module-level store backed by one localStorage key, in the pattern of
 * hooks/useWatchlist.ts: one value, one listener set, a `storage` event
 * listener for changes from other tabs, and try/catch on every storage
 * access. When storage fails, the value still works for this session.
 * A store whose value can be null removes the key when the value is null.
 */

export interface LocalStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  /** Replace the value with the result of `update`, write it and notify. */
  update: (update: (current: T) => T) => void;
}

export function createLocalStore<T>(
  key: string,
  parse: (raw: string | null) => T,
  serverValue: T,
): LocalStore<T> {
  const listeners = new Set<() => void>();
  // Null until the first read, so the browser reads storage only once.
  let cache: { value: T } | null = null;

  function read(): T {
    try {
      return parse(window.localStorage.getItem(key));
    } catch {
      return serverValue;
    }
  }

  function write(next: T): void {
    try {
      if (next === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage is not available. The in-memory value still holds the change.
    }
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== null && event.key !== key) return;
    cache = { value: read() };
    notify();
  }

  function getSnapshot(): T {
    cache ??= { value: read() };
    return cache.value;
  }

  return {
    subscribe(listener) {
      if (listeners.size === 0) window.addEventListener("storage", onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot,
    getServerSnapshot: () => serverValue,
    update(updater) {
      const current = getSnapshot();
      const next = updater(current);
      if (Object.is(next, current)) return;
      cache = { value: next };
      write(next);
      notify();
    },
  };
}
