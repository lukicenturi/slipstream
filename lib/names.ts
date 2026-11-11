import { isAddress } from "./address";
import { shortAddress } from "./format";

/*
 * Pure helpers for trader names: search input detection, address lists
 * for name lookups, and the display name priority.
 */

export type NameKind = "ens" | "hl";

export type SearchInput =
  | { kind: "address"; address: string }
  | { kind: NameKind; name: string }
  | { kind: "empty" }
  | { kind: "invalid" };

/** ENS names allow at most 255 characters. */
const MAX_NAME_LENGTH = 255;

/*
 * One or more non-empty labels, then ".eth" or ".hl". Labels cannot hold
 * white space or URL characters. The resolver checks the rest (ENS UTS-46
 * normalisation on the server, the HL Names length rule upstream).
 */
const NAME_PATTERN = /^(?:[^\s./\\?#%@:]+\.)+(eth|hl)$/u;

/**
 * Classify the text of the trader search box.
 * The input is trimmed and lower-cased. A bare word without a suffix is
 * `invalid`: the search accepts only addresses, `.eth` names and `.hl` names.
 */
export function parseSearchInput(raw: string): SearchInput {
  const value = raw.trim().toLowerCase();
  if (value === "") return { kind: "empty" };
  if (isAddress(value)) return { kind: "address", address: value };
  if (value.length > MAX_NAME_LENGTH) return { kind: "invalid" };
  const match = NAME_PATTERN.exec(value);
  if (!match) return { kind: "invalid" };
  return { kind: match[1] === "eth" ? "ens" : "hl", name: value };
}

/** True when the input looks like a `.eth` or `.hl` name (not an address). */
export function isLikelyName(raw: string): boolean {
  const { kind } = parseSearchInput(raw);
  return kind === "ens" || kind === "hl";
}

/**
 * Valid addresses only, lower-cased, without duplicates, sorted.
 * With a limit, the first `limit` unique addresses (in input order) are kept
 * before the sort, so callers decide which addresses matter most.
 */
export function uniqueAddresses(addresses: readonly string[], limit = Infinity): string[] {
  const seen = new Set<string>();
  for (const address of addresses) {
    if (seen.size >= limit) break;
    const lower = address.trim().toLowerCase();
    if (isAddress(lower)) seen.add(lower);
  }
  return [...seen].sort();
}

export type DisplayNameSource = "hyperliquid" | "hl" | "ens" | "address";

export interface DisplayName {
  label: string;
  source: DisplayNameSource;
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The label for a trader. Priority: the Hyperliquid display name from the
 * leaderboard, then the `.hl` primary name, then the ENS primary name,
 * then the short address.
 */
export function pickDisplayName({
  displayName,
  hlName,
  ensName,
  address,
}: {
  displayName?: string | null;
  hlName?: string | null;
  ensName?: string | null;
  address: string;
}): DisplayName {
  const hyperliquid = present(displayName);
  if (hyperliquid) return { label: hyperliquid, source: "hyperliquid" };
  const hl = present(hlName);
  if (hl) return { label: hl, source: "hl" };
  const ens = present(ensName);
  if (ens) return { label: ens, source: "ens" };
  return { label: shortAddress(address), source: "address" };
}
