import type { Fill } from "@/lib/hyperliquid/schemas";

/** Build a parsed fill for tests. Only the fields a test cares about need values. */
export function makeFill(overrides: Partial<Fill> = {}): Fill {
  return {
    coin: "BTC",
    px: 100,
    sz: 1,
    side: "buy",
    time: 1_000_000,
    dir: "Open Long",
    closedPnl: 0,
    oid: 1,
    tid: 1,
    fee: 0.1,
    hash: "0xabc",
    startPosition: 0,
    crossed: true,
    ...overrides,
  };
}
