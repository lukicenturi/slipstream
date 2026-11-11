import { parseWsMessage, type AllMidsMessage, type UserFillsMessage } from "./schemas";

/*
 * One shared WebSocket for the whole app.
 * - Subscriptions are reference counted by a stable key.
 * - The socket reconnects with exponential backoff and jitter, and sends
 *   every active subscription again after a reconnect.
 * - A ping goes out every 50 s, because the server closes idle sockets.
 * - The socket closes 5 s after the last subscriber leaves.
 * Components never use this class directly. They use the hooks in hooks/.
 */

export const WS_URL = "wss://api.hyperliquid.xyz/ws";

export type Subscription = { type: "allMids" } | { type: "userFills"; user: string };

export type MessageFor<S extends Subscription> = S extends { type: "allMids" }
  ? AllMidsMessage
  : UserFillsMessage;

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export type Unsubscribe = () => void;

type ChannelMessage = AllMidsMessage | UserFillsMessage;
type InternalHandler = (message: ChannelMessage) => void;

interface Entry {
  subscription: Subscription;
  handlers: Set<InternalHandler>;
}

/** The parts of the browser WebSocket that this class uses. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SocketOptions {
  url?: string;
  createSocket?: (url: string) => SocketLike;
  random?: () => number;
  pingIntervalMs?: number;
  idleCloseMs?: number;
}

const OPEN = 1;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const MAX_JITTER_MS = 500;

/** A stable key for a subscription. Addresses are lower-cased. */
export function subscriptionKey(subscription: Subscription): string {
  if (subscription.type === "allMids") return JSON.stringify({ type: "allMids" });
  return JSON.stringify({ type: "userFills", user: subscription.user.toLowerCase() });
}

function normalize(subscription: Subscription): Subscription {
  if (subscription.type === "allMids") return { type: "allMids" };
  return { type: "userFills", user: subscription.user.toLowerCase() };
}

/** The reconnect delay before jitter: 1 s, 2 s, 4 s, ... up to 30 s. */
export function backoffDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

export class HyperliquidSocket {
  private readonly url: string;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly random: () => number;
  private readonly pingIntervalMs: number;
  private readonly idleCloseMs: number;

  private socket: SocketLike | null = null;
  private readonly entries = new Map<string, Entry>();
  private status: ConnectionStatus = "closed";
  private readonly statusListeners = new Set<() => void>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private warnedInvalid = false;

  constructor(options: SocketOptions = {}) {
    this.url = options.url ?? WS_URL;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.random = options.random ?? Math.random;
    this.pingIntervalMs = options.pingIntervalMs ?? 50_000;
    this.idleCloseMs = options.idleCloseMs ?? 5_000;
  }

  subscribe<S extends Subscription>(
    subscription: S,
    handler: (message: MessageFor<S>) => void,
  ): Unsubscribe {
    const key = subscriptionKey(subscription);
    const internal = HyperliquidSocket.wrap(subscription, handler);

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { subscription: normalize(subscription), handlers: new Set() };
      this.entries.set(key, entry);
      // 0 -> 1: tell the server. When the socket is not open yet, the open
      // handler sends every active subscription.
      this.send({ method: "subscribe", subscription: entry.subscription });
    }
    entry.handlers.add(internal);

    this.clearIdleTimer();
    this.ensureConnected();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.release(key, internal);
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatus(listener: () => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** The number of handlers for one subscription. Used by tests. */
  refCount(subscription: Subscription): number {
    return this.entries.get(subscriptionKey(subscription))?.handlers.size ?? 0;
  }

  /** Drop the connection on purpose, to test the reconnect path. */
  forceReconnect(): void {
    if (this.socket) {
      // The close handler schedules the reconnect.
      this.socket.close(4000, "force reconnect");
    } else if (this.entries.size > 0) {
      this.clearReconnectTimer();
      this.attempt = 0;
      this.connect();
    }
  }

  // -------------------------------------------------------------------------

  /** Wrap a typed handler, so that it only receives its own channel. */
  private static wrap<S extends Subscription>(
    subscription: S,
    handler: (message: MessageFor<S>) => void,
  ): InternalHandler {
    // The conditional type MessageFor<S> does not narrow inside a generic
    // function, so the two branches check the channel at run time.
    const typed = handler as (message: ChannelMessage) => void;
    if (subscription.type === "allMids") {
      return (message) => {
        if (message.channel === "allMids") typed(message);
      };
    }
    return (message) => {
      if (message.channel === "userFills") typed(message);
    };
  }

  private release(key: string, handler: InternalHandler): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.handlers.delete(handler);
    if (entry.handlers.size > 0) return;

    // 1 -> 0: tell the server (only when the socket is open).
    this.entries.delete(key);
    this.send({ method: "unsubscribe", subscription: entry.subscription });

    if (this.entries.size === 0) this.scheduleIdleClose();
  }

  private ensureConnected(): void {
    if (this.socket || this.reconnectTimer) return;
    this.connect();
  }

  private connect(): void {
    this.setStatus(this.attempt > 0 ? "reconnecting" : "connecting");
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus("open");
      for (const entry of this.entries.values()) {
        this.send({ method: "subscribe", subscription: entry.subscription });
      }
      this.startPing();
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    };

    socket.onerror = () => {
      // A close event always follows. The close handler does the work.
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      if (this.entries.size > 0) {
        this.scheduleReconnect();
      } else {
        this.setStatus("closed");
      }
    };
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(data);
    } catch {
      this.warnInvalid(data);
      return;
    }

    const message = parseWsMessage(decoded);
    if (!message) {
      this.warnInvalid(data);
      return;
    }

    let key: string;
    if (message.channel === "allMids") {
      key = subscriptionKey({ type: "allMids" });
    } else if (message.channel === "userFills") {
      key = subscriptionKey({ type: "userFills", user: message.user });
    } else {
      // subscriptionResponse, pong and unknown channels need no routing.
      return;
    }

    const entry = this.entries.get(key);
    if (!entry) return;
    for (const handler of [...entry.handlers]) {
      try {
        handler(message);
      } catch (error) {
        console.error("[ws] A subscription handler failed.", error);
      }
    }
  }

  private warnInvalid(data: string): void {
    if (this.warnedInvalid) return;
    this.warnedInvalid = true;
    console.warn("[ws] Dropped a message that does not match the schema.", data.slice(0, 200));
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = backoffDelay(this.attempt) + this.random() * MAX_JITTER_MS;
    this.attempt += 1;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.entries.size > 0) this.connect();
      else this.setStatus("closed");
    }, delay);
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.entries.size > 0) return;
      this.clearReconnectTimer();
      this.attempt = 0;
      const socket = this.socket;
      this.socket = null;
      this.stopPing();
      socket?.close(1000, "idle");
      this.setStatus("closed");
    }, this.idleCloseMs);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ method: "ping" }), this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private send(payload: object): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(payload));
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of [...this.statusListeners]) listener();
  }
}

// ---------------------------------------------------------------------------
// The app-wide singleton. Created on first use, in the browser only.
// ---------------------------------------------------------------------------

let instance: HyperliquidSocket | null = null;

/** The shared socket, or null on the server. */
export function getHyperliquidSocket(): HyperliquidSocket | null {
  if (typeof window === "undefined") return null;
  instance ??= new HyperliquidSocket();
  return instance;
}
