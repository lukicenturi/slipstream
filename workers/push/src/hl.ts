import { parseFills, type Fill, type Network } from "./schemas";

/** The Hyperliquid info endpoints. The Worker reads only; it never calls /exchange. */
export const INFO_URLS: Record<Network, string> = {
  mainnet: "https://api.hyperliquid.xyz/info",
  testnet: "https://api.hyperliquid-testnet.xyz/info",
};

export const FETCH_TIMEOUT_MS = 10_000;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The fills of `user` at or after `startTime` (ms), oldest first.
 * `aggregateByTime` merges the parts of one order that filled at the same time.
 * Throws on a network error, a timeout, a non-2xx status or a bad body.
 */
export async function fetchFillsSince(
  network: Network,
  user: string,
  startTime: number,
  fetchFn: FetchFn = fetch,
): Promise<Fill[]> {
  const response = await fetchFn(INFO_URLS[network], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "userFillsByTime", user, startTime, aggregateByTime: true }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`info ${response.status}`);
  const fills = parseFills(await response.json());
  if (!fills) throw new Error("info: unexpected body");
  return fills;
}
