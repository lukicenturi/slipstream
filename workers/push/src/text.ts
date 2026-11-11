/*
 * The notification text. This is a small copy of the app's pure helpers
 * (lib/format.ts, lib/calc/fillAction.ts and noticeText in
 * lib/notifications.ts), so that a push reads the same as an in-tab notice.
 * The app modules import through the `@/` alias and pull in zod schemas, so
 * the Worker does not import them. lib/push-text.test.ts in the app checks
 * that both copies give the same text.
 */

const EMPTY_VALUE = "—";

const usdCents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdCompact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const smallPrice = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 });
const sizeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function signPrefix(value: number): string {
  return value < 0 ? "-" : "";
}

/** Remove the sign of -0 and of values that round to 0. */
function clean(value: number, formatted: string): number {
  return /[1-9]/.test(formatted) ? value : 0;
}

/** $12.4K, $146.8M, $55.45. */
export function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const body = abs >= 1000 ? usdCompact.format(abs) : usdCents.format(abs);
  return `${signPrefix(clean(value, body))}$${body}`;
}

/** Up to 5 significant digits, at least 2 decimals from 1 up. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  if (abs < 1) {
    const body = smallPrice.format(abs);
    return `${signPrefix(clean(value, body))}${body}`;
  }
  const integerDigits = Math.floor(Math.log10(abs)) + 1;
  const decimals = Math.max(2, 5 - integerDigits);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
  return `${signPrefix(value)}${body}`;
}

/** Up to 4 decimals, trailing zeros removed. */
export function formatSize(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const body = sizeFormat.format(Math.abs(value));
  return `${signPrefix(clean(value, body))}${body}`;
}

/** 0xf5d81a135f756ca16544e53c20fc20643ec3ad53 -> 0xf5d8…ad53. */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 12s ago, 3m ago, 2h ago, 4d ago. */
export function formatRelativeTime(timeMs: number, now: number): string {
  if (!Number.isFinite(timeMs) || !Number.isFinite(now)) return EMPTY_VALUE;
  const diff = Math.max(0, now - timeMs);
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}s ago`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

const PHRASES: Record<string, string> = {
  "Open Long": "opened long",
  "Open Short": "opened short",
  "Close Long": "closed long",
  "Close Short": "closed short",
  "Long > Short": "flipped to short",
  "Short > Long": "flipped to long",
  Buy: "bought",
  Sell: "sold",
};

/** The words for a fill `dir`, such as "opened long" or "was liquidated". */
export function fillPhrase(dir: string): string {
  const known = PHRASES[dir];
  if (known) return known;
  if (dir.startsWith("Liquidated")) return "was liquidated";
  return dir.toLowerCase();
}

/** `dir` values that the exchange creates on its own, not trades of the user. */
const SYSTEM_DIRS = new Set(["Spot Dust Conversion"]);

export function isSystemFill(dir: string): boolean {
  return SYSTEM_DIRS.has(dir);
}

export interface NoticeFields {
  coin: string;
  dir: string;
  notionalUsd: number;
  sizeCoin: number;
  avgPx: number;
  time: number;
}

/**
 * The same title and body as an in-tab notice, for example
 * "testooor.hl opened long BTC" and "$12.4K · 0.17 BTC @ 74,650.00 · 2m ago".
 */
export function noticeText(
  notice: NoticeFields,
  label: string,
  now: number,
): { title: string; body: string } {
  return {
    title: `${label} ${fillPhrase(notice.dir)} ${notice.coin}`,
    body: [
      formatUsdCompact(notice.notionalUsd),
      `${formatSize(notice.sizeCoin)} ${notice.coin} @ ${formatPrice(notice.avgPx)}`,
      formatRelativeTime(notice.time, Math.max(now, notice.time)),
    ].join(" · "),
  };
}

/** The summary text when one subscription gets many trades in one tick. */
export function burstText(count: number): string {
  return `${count} new ${count === 1 ? "trade" : "trades"} from traders you follow`;
}
