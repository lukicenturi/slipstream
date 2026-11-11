import { spotMetaSchema, type SpotToken, type SpotTokenMap } from "./schemas";

/*
 * Trim the raw spotMeta (about 140 KB on mainnet, 440 KB on testnet) to a
 * token map: name -> { index, szDecimals, pair }. `pair` is the allMids key
 * of the token's USDC pair. This file has no server-only import, so Vitest
 * can test it; lib/hyperliquid/spot-meta-server.ts calls it.
 */

/** USDC is token 0 on both networks. */
export const USDC_TOKEN_INDEX = 0;

/** Throws when the raw response does not match the schema. */
export function buildSpotTokenMap(raw: unknown, now: number): SpotTokenMap {
  const meta = spotMetaSchema.parse(raw);

  // Base token index -> its USDC pair. A canonical pair wins over a later one.
  const pairs = new Map<number, { name: string; canonical: boolean }>();
  for (const market of meta.universe) {
    const [base, quote] = market.tokens;
    if (quote !== USDC_TOKEN_INDEX) continue;
    const canonical = market.isCanonical === true;
    const known = pairs.get(base);
    if (known && (known.canonical || !canonical)) continue;
    pairs.set(base, { name: market.name, canonical });
  }

  // A Map, then Object.fromEntries: a token name such as "constructor" stays
  // an own key and never touches the object prototype.
  const tokens = new Map<string, SpotToken>();
  for (const token of meta.tokens) {
    // Names are unique in practice. Keep the first one if a name repeats.
    if (tokens.has(token.name)) continue;
    tokens.set(token.name, {
      index: token.index,
      szDecimals: token.szDecimals,
      pair: pairs.get(token.index)?.name ?? null,
    });
  }
  return { updatedAt: now, tokens: Object.fromEntries(tokens) };
}
