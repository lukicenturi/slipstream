/*
 * A small store for mid prices. Listeners subscribe per coin and only hear
 * about changes to that coin, so a BTC tick does not re-render an ETH row.
 */

type Listener = () => void;

export interface MidsStore {
  get(coin: string): number | undefined;
  subscribe(coin: string, listener: Listener): () => void;
  subscribeAll(listener: Listener): () => void;
  ingest(mids: Record<string, number>): void;
}

export function createMidsStore(): MidsStore {
  const values = new Map<string, number>();
  const coinListeners = new Map<string, Set<Listener>>();
  const allListeners = new Set<Listener>();

  return {
    get(coin) {
      return values.get(coin);
    },

    subscribe(coin, listener) {
      let listeners = coinListeners.get(coin);
      if (!listeners) {
        listeners = new Set();
        coinListeners.set(coin, listeners);
      }
      listeners.add(listener);
      return () => {
        const current = coinListeners.get(coin);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) coinListeners.delete(coin);
      };
    },

    subscribeAll(listener) {
      allListeners.add(listener);
      return () => {
        allListeners.delete(listener);
      };
    },

    ingest(mids) {
      const changed: string[] = [];
      for (const [coin, value] of Object.entries(mids)) {
        if (values.get(coin) === value) continue;
        values.set(coin, value);
        changed.push(coin);
      }
      if (changed.length === 0) return;
      for (const coin of changed) {
        const listeners = coinListeners.get(coin);
        if (listeners) for (const listener of [...listeners]) listener();
      }
      for (const listener of [...allListeners]) listener();
    },
  };
}

/** The app-wide mids store. MidsFeeder fills it from the shared socket. */
export const midsStore = createMidsStore();
