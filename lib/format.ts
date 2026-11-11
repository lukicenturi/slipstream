/*
 * Number, address and time formatters. All output uses en-US.
 * Non-finite input renders as an em dash, so a bad value never shows "NaN".
 */

export const EMPTY_VALUE = "—";

const usdWhole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdCompact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const smallPrice = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 });
const size = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function signPrefix(value: number, signed: boolean): string {
  if (value < 0) return "-";
  if (signed && value > 0) return "+";
  return "";
}

/** Remove the sign of -0 and of values that round to 0. */
function clean(value: number, formatted: string): number {
  return /[1-9]/.test(formatted) ? value : 0;
}

export interface UsdOptions {
  /** $146.8M instead of $146,792,255. */
  compact?: boolean;
  /** Add "+" to positive values. */
  signed?: boolean;
}

/**
 * $146,792,255 / $146.8M / +$1.2K / -$12.34.
 * Values of 1,000 and above show no cents. Smaller values show 2 decimals.
 */
export function formatUsd(value: number, options: UsdOptions = {}): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1000) {
    body = options.compact ? usdCompact.format(abs) : usdWhole.format(abs);
  } else {
    body = usdCents.format(abs);
  }
  return `${signPrefix(clean(value, body), options.signed ?? false)}$${body}`;
}

/** +83.69% from 0.8369. */
export function formatPercent(ratio: number, options: { signed?: boolean } = {}): string {
  if (!Number.isFinite(ratio)) return EMPTY_VALUE;
  const body = percent.format(Math.abs(ratio * 100));
  return `${signPrefix(clean(ratio, body), options.signed ?? false)}${body}%`;
}

/**
 * Prices: up to 5 significant digits, and at least 2 decimals for values
 * of 1 and above. 73848.5 -> 73,848.50, 82.8205 -> 82.821, 0.116438 -> 0.11644.
 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  if (abs < 1) {
    const body = smallPrice.format(abs);
    return `${signPrefix(clean(value, body), false)}${body}`;
  }
  const integerDigits = Math.floor(Math.log10(abs)) + 1;
  const decimals = Math.max(2, 5 - integerDigits);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
  return `${signPrefix(value, false)}${body}`;
}

/** Sizes in coin units: up to 4 decimals, trailing zeros removed. */
export function formatSize(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const body = size.format(Math.abs(value));
  return `${signPrefix(clean(value, body), false)}${body}`;
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

/** 12s ago, 3m ago, 2h ago, 4d ago. Future times show 0s ago. */
export function formatRelativeTime(timeMs: number, now: number = Date.now()): string {
  if (!Number.isFinite(timeMs) || !Number.isFinite(now)) return EMPTY_VALUE;
  const diff = Math.max(0, now - timeMs);
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}s ago`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

/** The two largest units of a duration: 45s, 5m 12s, 2h 15m, 3d 4h. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return EMPTY_VALUE;
  const total = Math.max(0, Math.floor(ms / SECOND));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const units: [number, string][] = [
    [days, "d"],
    [hours, "h"],
    [minutes, "m"],
    [seconds, "s"],
  ];
  const first = units.findIndex(([amount]) => amount > 0);
  if (first === -1) return "0s";
  return units
    .slice(first, first + 2)
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount}${unit}`)
    .join(" ");
}
