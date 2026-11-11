import type {
  ClearinghouseState,
  LedgerDexMove,
  Position,
  SpotBalance,
  SpotToken,
} from "@/lib/hyperliquid/schemas";

/*
 * Balances across every perp exchange and spot. Hyperliquid has the main
 * perp exchange, builder-deployed perp exchanges (HIP-3, for example
 * "vntls" on testnet) with their own margin accounts, and a spot account.
 * These pure functions decide which builder exchanges to read, price spot
 * balances with the mids of their USDC pairs, and add everything up.
 */

/** With at most this many builder exchanges, the app reads all of them. */
export const QUERY_ALL_DEX_LIMIT = 20;

/** Below this USD value a balance counts as small. */
export const SMALL_BALANCE_USD = 1;

/** The ledger uses "" for the main perp exchange and "spot" for the spot account. */
function isBuilderDexName(name: string | null): name is string {
  return name !== null && name !== "" && name !== "spot";
}

/** "vntls:vOAI" -> "vntls". Main perps ("BTC") and spot pairs ("@1035") give null. */
export function dexOfCoin(coin: string): string | null {
  const colon = coin.indexOf(":");
  return colon > 0 ? coin.slice(0, colon) : null;
}

/**
 * The builder exchanges that took part in the address's transfers. For a
 * send by the address, that is the source exchange; for a send to it, the
 * destination exchange. When the sender and the receiver are both unknown,
 * both names count.
 */
export function dexesFromLedger(moves: readonly LedgerDexMove[], address: string): string[] {
  const self = address.toLowerCase();
  const found = new Set<string>();
  for (const move of moves) {
    const unknownParties = move.user === null && move.destination === null;
    if (move.user === self || unknownParties) {
      if (isBuilderDexName(move.sourceDex)) found.add(move.sourceDex);
    }
    if (move.destination === self || unknownParties) {
      if (isBuilderDexName(move.destinationDex)) found.add(move.destinationDex);
    }
  }
  return [...found].sort();
}

/**
 * The builder exchanges to read for an address.
 * - When the full list is known and has at most `queryAllLimit` entries
 *   (mainnet has 10), read every exchange.
 * - Otherwise (testnet has about 280), read only the exchanges that the
 *   fills or the ledger name. A known list filters out unknown names.
 * `allDexes` is null when the list did not load.
 */
export function discoverDexes({
  allDexes,
  fillCoins,
  ledgerDexes,
  queryAllLimit = QUERY_ALL_DEX_LIMIT,
}: {
  allDexes: readonly string[] | null;
  fillCoins: readonly string[];
  ledgerDexes: readonly string[];
  queryAllLimit?: number;
}): string[] {
  if (allDexes !== null && allDexes.length <= queryAllLimit) return [...allDexes];
  const found = new Set<string>();
  for (const coin of fillCoins) {
    const dex = dexOfCoin(coin);
    if (dex !== null) found.add(dex);
  }
  for (const dex of ledgerDexes) if (isBuilderDexName(dex)) found.add(dex);
  const known = allDexes === null ? null : new Set(allDexes);
  return [...found].filter((dex) => known === null || known.has(dex)).sort();
}

/** True when the full exchange list is short enough to read every exchange. */
export function queriesAllDexes(
  allDexes: readonly string[] | null,
  queryAllLimit = QUERY_ALL_DEX_LIMIT,
): boolean {
  return allDexes !== null && allDexes.length <= queryAllLimit;
}

// ---------------------------------------------------------------------------
// Spot
// ---------------------------------------------------------------------------

export const USDC = "USDC";

export interface SpotRow extends SpotBalance {
  /** The allMids key of the token's USDC pair, or null when there is none. */
  pair: string | null;
  /** USD per token: 1 for USDC, else the pair mid; null when unknown. */
  price: number | null;
  /** total * price, or null when the token cannot be priced. */
  usdValue: number | null;
}

/** The token's USDC pair, or null. Own keys only, so "constructor" is not a token. */
export function spotPairOf(
  coin: string,
  tokenMap: Readonly<Record<string, SpotToken>> | undefined,
): string | null {
  if (coin === USDC || !tokenMap || !Object.hasOwn(tokenMap, coin)) return null;
  return tokenMap[coin]?.pair ?? null;
}

/** The pair keys whose mids the spot balances need (no duplicates). */
export function spotPairsOf(
  balances: readonly SpotBalance[],
  tokenMap: Readonly<Record<string, SpotToken>> | undefined,
): string[] {
  const pairs = new Set<string>();
  for (const balance of balances) {
    const pair = spotPairOf(balance.coin, tokenMap);
    if (pair !== null) pairs.add(pair);
  }
  return [...pairs].sort();
}

/**
 * Price each spot balance. USDC is 1:1. Other tokens use the mid of their
 * USDC pair. `usdValue` is null when the token has no USDC pair or the pair
 * has no mid yet.
 */
export function priceSpotBalances(
  balances: readonly SpotBalance[],
  tokenMap: Readonly<Record<string, SpotToken>> | undefined,
  getMid: (pair: string) => number | undefined,
): SpotRow[] {
  return balances.map((balance) => {
    const pair = spotPairOf(balance.coin, tokenMap);
    let price: number | null = null;
    if (balance.coin === USDC) price = 1;
    else if (pair !== null) {
      const mid = getMid(pair);
      if (mid !== undefined && Number.isFinite(mid) && mid >= 0) price = mid;
    }
    return { ...balance, pair, price, usdValue: price === null ? null : balance.total * price };
  });
}

// ---------------------------------------------------------------------------
// Account summary
// ---------------------------------------------------------------------------

export interface DexState {
  dex: string;
  state: ClearinghouseState;
}

/** A position with its exchange: null is the main perp exchange. */
export type AccountPosition = Position & { dex: string | null };

export interface PerpAccount {
  /** null is the main perp exchange. */
  dex: string | null;
  accountValue: number;
  withdrawable: number;
  marginUsed: number;
}

export interface AccountSummary {
  /**
   * Perp account values plus priced spot. In a unified account the perp
   * margin is inside the spot USDC balance, so the total is the spot value.
   */
  totalUsd: number;
  /** True for a unified or portfolio margin account. */
  unified: boolean;
  perpsUsd: number;
  /** The main exchange first (when loaded), then the builder exchanges. */
  perpsByDex: PerpAccount[];
  spotUsd: number;
  /** Spot balances above 0 that have no price. */
  spotUnpricedCount: number;
  /** The part of spotUnpricedCount that has a USDC pair but no mid yet. */
  spotWaitingCount: number;
  positions: AccountPosition[];
}

/** Every open position of the main and the builder exchanges. */
export function collectPositions(
  main: ClearinghouseState | undefined,
  dexStates: readonly DexState[],
): AccountPosition[] {
  const positions: AccountPosition[] = [];
  if (main) for (const position of main.positions) positions.push({ ...position, dex: null });
  for (const { dex, state } of dexStates) {
    for (const position of state.positions) positions.push({ ...position, dex });
  }
  return positions;
}

export function summarizeAccount({
  main,
  dexStates,
  spotRows,
  unified = false,
}: {
  main: ClearinghouseState | undefined;
  dexStates: readonly DexState[];
  spotRows: readonly SpotRow[];
  /** A unified or portfolio margin account (isUnifiedAbstraction). */
  unified?: boolean;
}): AccountSummary {
  const perpsByDex = perpAccounts(main, dexStates);

  const perpsUsd = perpsByDex.reduce((sum, account) => sum + account.accountValue, 0);
  let spotUsd = 0;
  let spotUnpricedCount = 0;
  let spotWaitingCount = 0;
  for (const row of spotRows) {
    if (row.usdValue !== null) spotUsd += row.usdValue;
    else if (row.total !== 0) {
      spotUnpricedCount += 1;
      if (row.pair !== null) spotWaitingCount += 1;
    }
  }
  return {
    totalUsd: unified ? spotUsd : perpsUsd + spotUsd,
    unified,
    perpsUsd,
    perpsByDex,
    spotUsd,
    spotUnpricedCount,
    spotWaitingCount,
    positions: collectPositions(main, dexStates),
  };
}

/** The main perp account (when loaded) first, then the builder exchanges. */
export function perpAccounts(
  main: ClearinghouseState | undefined,
  dexStates: readonly DexState[],
): PerpAccount[] {
  const accounts: PerpAccount[] = [];
  if (main) accounts.push(perpAccount(null, main));
  for (const { dex, state } of dexStates) accounts.push(perpAccount(dex, state));
  return accounts;
}

function perpAccount(dex: string | null, state: ClearinghouseState): PerpAccount {
  return {
    dex,
    accountValue: state.accountValue,
    withdrawable: state.withdrawable,
    marginUsed: state.totalMarginUsed,
  };
}

/** The builder exchange with the most withdrawable USDC, or null when none holds any. */
export function builderDexWithUsdc(perpsByDex: readonly PerpAccount[]): PerpAccount | null {
  let best: PerpAccount | null = null;
  for (const account of perpsByDex) {
    if (account.dex === null || account.withdrawable < 0.01) continue;
    if (!best || account.withdrawable > best.withdrawable) best = account;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Balance rows (the Balances panel)
// ---------------------------------------------------------------------------

export interface BalanceRow {
  /** "perp:main", "perp:vntls" or "spot:HARRR". */
  id: string;
  asset: string;
  kind: "perp" | "spot";
  /** The builder exchange of a perp row; null for main perps and spot. */
  dex: string | null;
  /** Perps: the account value. Spot: the token total. */
  total: number;
  /** Perps: the withdrawable USDC. Spot: null. */
  available: number | null;
  usdValue: number | null;
  /** False for a perp row of a unified account: its margin is inside spot USDC. */
  inTotal: boolean;
  /** The pair of a spot token, or null. */
  pair: string | null;
}

/**
 * A row is small when its USD value is below the threshold. A row without
 * a price is small only when its total is 0, so an unpriced token never
 * hides.
 */
export function isSmallBalance(
  row: Pick<BalanceRow, "total" | "usdValue">,
  thresholdUsd = SMALL_BALANCE_USD,
): boolean {
  if (row.usdValue === null) return row.total === 0;
  return row.usdValue < thresholdUsd;
}

/** Perp accounts and spot rows as one list, by USD value (largest first), unpriced last. */
export function balanceRows(
  perpsByDex: readonly PerpAccount[],
  spotRows: readonly SpotRow[],
  unified = false,
): BalanceRow[] {
  const rows: BalanceRow[] = [
    ...perpsByDex.map((account): BalanceRow => ({
      id: `perp:${account.dex ?? "main"}`,
      asset: USDC,
      kind: "perp",
      dex: account.dex,
      total: account.accountValue,
      available: account.withdrawable,
      usdValue: account.accountValue,
      inTotal: !unified,
      pair: null,
    })),
    ...spotRows.map((row): BalanceRow => ({
      id: `spot:${row.coin}`,
      asset: row.coin,
      kind: "spot",
      dex: null,
      total: row.total,
      available: null,
      usdValue: row.usdValue,
      inTotal: true,
      pair: row.pair,
    })),
  ];
  return rows.sort(compareBalanceRows);
}

function compareBalanceRows(a: BalanceRow, b: BalanceRow): number {
  if (a.usdValue === null && b.usdValue === null) return a.asset.localeCompare(b.asset);
  if (a.usdValue === null) return 1;
  if (b.usdValue === null) return -1;
  if (b.usdValue !== a.usdValue) return b.usdValue - a.usdValue;
  return a.id.localeCompare(b.id);
}
