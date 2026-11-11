import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffDelay, HyperliquidSocket, subscriptionKey, type SocketLike } from "./ws";

/** A fake WebSocket that records what the class sends. */
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.(new Event("close") as CloseEvent);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  receive(payload: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

const USER = "0xF5d81a135f756ca16544e53c20fc20643ec3ad53";
const fill = {
  coin: "BTC",
  px: "100.5",
  sz: "1",
  side: "B",
  time: 1,
  startPosition: "0",
  dir: "Open Long",
  closedPnl: "0.0",
  hash: "0xabc",
  oid: 1,
  crossed: true,
  fee: "0.1",
  tid: 2,
};

function setup() {
  const sockets: FakeSocket[] = [];
  const client = new HyperliquidSocket({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    random: () => 0,
  });
  const last = (): FakeSocket => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error("No socket");
    return socket;
  };
  return { client, sockets, last };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("subscriptionKey", () => {
  it("lower-cases the user", () => {
    expect(subscriptionKey({ type: "userFills", user: USER })).toBe(
      subscriptionKey({ type: "userFills", user: USER.toLowerCase() }),
    );
  });
});

describe("backoffDelay", () => {
  it("doubles and caps at 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(backoffDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});

describe("HyperliquidSocket", () => {
  it("opens lazily and sends subscriptions on open", () => {
    const { client, sockets, last } = setup();
    expect(sockets).toHaveLength(0);
    client.subscribe({ type: "allMids" }, () => {});
    expect(client.getStatus()).toBe("connecting");
    last().open();
    expect(client.getStatus()).toBe("open");
    expect(last().sent).toEqual([{ method: "subscribe", subscription: { type: "allMids" } }]);
  });

  it("reference counts subscriptions by key", () => {
    const { client, last } = setup();
    const first = client.subscribe({ type: "userFills", user: USER }, () => {});
    last().open();
    const second = client.subscribe({ type: "userFills", user: USER.toLowerCase() }, () => {});
    expect(client.refCount({ type: "userFills", user: USER })).toBe(2);
    expect(last().sent).toHaveLength(1);

    first();
    first();
    expect(last().sent).toHaveLength(1);
    second();
    expect(last().sent.at(-1)).toEqual({
      method: "unsubscribe",
      subscription: { type: "userFills", user: USER.toLowerCase() },
    });
  });

  it("routes parsed messages to the matching handlers", () => {
    const { client, last } = setup();
    const mids = vi.fn();
    const fills = vi.fn();
    client.subscribe({ type: "allMids" }, mids);
    client.subscribe({ type: "userFills", user: USER }, fills);
    last().open();

    last().receive({ channel: "allMids", data: { mids: { BTC: "100", "@1": "2" } } });
    expect(mids).toHaveBeenCalledWith({ channel: "allMids", mids: { BTC: 100 } });

    last().receive({ channel: "userFills", data: { user: USER.toLowerCase(), fills: [fill] } });
    expect(fills).toHaveBeenCalledTimes(1);
    expect(fills.mock.calls[0]?.[0]).toMatchObject({ isSnapshot: false, fills: [{ px: 100.5 }] });
  });

  it("drops invalid messages with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, last } = setup();
    const mids = vi.fn();
    client.subscribe({ type: "allMids" }, mids);
    last().open();
    last().receive({ channel: "allMids", data: {} });
    last().receive({ channel: "allMids", data: null });
    expect(mids).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("reconnects with backoff and resubscribes every active key", () => {
    const { client, sockets, last } = setup();
    client.subscribe({ type: "allMids" }, () => {});
    client.subscribe({ type: "userFills", user: USER }, () => {});
    last().open();

    last().close();
    expect(client.getStatus()).toBe("reconnecting");
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // A failed attempt doubles the delay.
    last().close();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    last().open();
    expect(last().sent).toEqual([
      { method: "subscribe", subscription: { type: "allMids" } },
      { method: "subscribe", subscription: { type: "userFills", user: USER.toLowerCase() } },
    ]);
    expect(client.getStatus()).toBe("open");
  });

  it("forceReconnect drops the socket and reconnects", () => {
    const { client, sockets, last } = setup();
    client.subscribe({ type: "allMids" }, () => {});
    last().open();
    client.forceReconnect();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
  });

  it("tracks the time since the socket left the open state", () => {
    const { client, last } = setup();
    expect(client.getDownSince()).toBeNull();
    vi.setSystemTime(1_000);
    client.subscribe({ type: "allMids" }, () => {});
    expect(client.getDownSince()).toBe(1_000);
    last().open();
    expect(client.getDownSince()).toBeNull();

    vi.setSystemTime(5_000);
    last().close();
    expect(client.getDownSince()).toBe(5_000);
    // A failed retry keeps the first down time.
    vi.advanceTimersByTime(1_000);
    last().close();
    expect(client.getDownSince()).toBe(5_000);
    vi.advanceTimersByTime(2_000);
    last().open();
    expect(client.getDownSince()).toBeNull();
  });

  it("pings every 50 s while open", () => {
    const { client, last } = setup();
    client.subscribe({ type: "allMids" }, () => {});
    last().open();
    vi.advanceTimersByTime(50_000);
    expect(last().sent.at(-1)).toEqual({ method: "ping" });
  });

  it("closes 5 s after the last subscriber leaves", () => {
    const { client, sockets, last } = setup();
    const statuses: string[] = [];
    client.onStatus(() => statuses.push(client.getStatus()));
    const unsubscribe = client.subscribe({ type: "allMids" }, () => {});
    last().open();
    unsubscribe();
    vi.advanceTimersByTime(4_999);
    expect(last().readyState).toBe(1);

    // A new subscriber inside the grace period keeps the socket.
    const again = client.subscribe({ type: "allMids" }, () => {});
    vi.advanceTimersByTime(10_000);
    expect(last().readyState).toBe(1);

    again();
    vi.advanceTimersByTime(5_000);
    expect(last().readyState).toBe(3);
    expect(client.getStatus()).toBe("closed");
    expect(sockets).toHaveLength(1);
    expect(statuses).toEqual(["connecting", "open", "closed"]);
  });
});
