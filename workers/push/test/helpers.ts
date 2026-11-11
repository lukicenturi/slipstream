import type { Fill, WatchRow } from "../src/schemas";

export const A = "0x5b5d51203a0f9079f8aeb098a6523a13f298c060";
export const B = "0xf5d81a135f756ca16544e53c20fc20643ec3ad53";

export function fill(overrides: Partial<Fill> = {}): Fill {
  return {
    coin: "BTC",
    px: 100,
    sz: 1,
    side: "buy",
    time: 1_000,
    dir: "Open Long",
    closedPnl: 0,
    oid: 1,
    tid: 1,
    ...overrides,
  };
}

export function row(overrides: Partial<WatchRow> = {}): WatchRow {
  return {
    id: "sub-1",
    endpoint: "https://push.example/1",
    p256dh: "p256dh-key-value-1234",
    auth: "auth-key-1",
    network: "mainnet",
    min_notional: 0,
    failures: 0,
    address: A,
    label: null,
    last_time: null,
    seen_tids: null,
    polled_at: null,
    ...overrides,
  };
}
