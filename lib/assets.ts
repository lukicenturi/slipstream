/*
 * Helpers for asset icons. Icons come from Hyperliquid's public coin
 * images. The file names are case-sensitive and upper-case ("BTC.svg").
 */

const ICON_BASE_URL = "https://app.hyperliquid.xyz/coins";

/** "xyz:NVDA" -> "NVDA". Spot ("@107") and builder ("#114910") ids stay as they are. */
export function displaySymbol(coin: string): string {
  const colon = coin.indexOf(":");
  return colon >= 0 ? coin.slice(colon + 1) : coin;
}

/**
 * The icon file name of a coin, or null when the coin has no icon:
 * coins of other perp DEXs ("xyz:NVDA"), spot ids ("@107") and builder ids
 * ("#114910"). The "k" prefix of 1,000-unit coins is dropped ("kPEPE" ->
 * "PEPE"), because only the base coin has an icon.
 */
export function iconSymbol(coin: string): string | null {
  const trimmed = coin.trim();
  if (trimmed === "" || trimmed.includes(":")) return null;
  if (trimmed.startsWith("@") || trimmed.startsWith("#")) return null;
  const base = /^k[A-Z0-9]{2,}$/.test(trimmed) ? trimmed.slice(1) : trimmed;
  return base.toUpperCase();
}

export function iconUrl(symbol: string): string {
  return `${ICON_BASE_URL}/${encodeURIComponent(symbol)}.svg`;
}

/** The 2 characters of the fallback monogram: "BTC" -> "BT", "xyz:NVDA" -> "NV", "@107" -> "10". */
export function monogram(coin: string): string {
  const letters = displaySymbol(coin).replace(/[^A-Za-z0-9]/g, "");
  return (letters || "?").slice(0, 2).toUpperCase();
}
