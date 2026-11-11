"use client";

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useSpotTokenMap } from "@/hooks/useSpotTokenMap";
import { useTraderFills, useTraderState } from "@/hooks/useTrader";
import {
  balanceRows,
  discoverDexes,
  priceSpotBalances,
  queriesAllDexes,
  spotPairsOf,
  summarizeAccount,
  type AccountSummary,
  type BalanceRow,
  type DexState,
  type SpotRow,
} from "@/lib/calc/balances";
import {
  getClearinghouseState,
  getLedgerDexes,
  getPerpDexs,
  getSpotClearinghouseState,
  getUserAbstraction,
} from "@/lib/hyperliquid/client";
import { midsStore } from "@/lib/hyperliquid/mids";
import {
  isUnifiedAbstraction,
  type ClearinghouseState,
  type SpotBalance,
  type SpotTokenMap,
  type UserAbstraction,
} from "@/lib/hyperliquid/schemas";

/*
 * Balances of one address across every perp exchange and spot:
 * - the main perp account (the profile's query key),
 * - the builder perp exchanges that discoverDexes picks (all of them on
 *   mainnet; on testnet only those named by fills or the ledger),
 * - the spot balances and the spot token map (for the USDC pairs),
 * - the account mode: in a unified account the perp margin is part of spot USDC.
 * Prices come from the shared socket's mids store (useLiveAccountSummary).
 */

const PERP_DEXS_STALE_MS = 60 * 60_000;
const LEDGER_STALE_MS = 5 * 60_000;
const ABSTRACTION_STALE_MS = 5 * 60_000;
const PART_REFRESH_MS = 30_000;

export type PartStatus = "pending" | "error" | "success";

export interface BalancePart<T> {
  status: PartStatus;
  data: T | undefined;
  refetch: () => void;
}

export interface DexPart extends BalancePart<ClearinghouseState> {
  dex: string;
}

export interface AccountBalances {
  main: BalancePart<ClearinghouseState>;
  /** One entry per discovered builder exchange. */
  dexes: DexPart[];
  /** The builder exchanges that loaded. */
  dexStates: DexState[];
  spot: BalancePart<SpotBalance[]>;
  tokenMap: BalancePart<SpotTokenMap>;
  /** The account mode. Loaded together with spot. */
  abstraction: BalancePart<UserAbstraction>;
  /** The list of builder exchanges. On error, discovery uses fills and the ledger only. */
  perpDexs: BalancePart<unknown>;
  /** The ledger signal. "success" when it is not needed. */
  ledger: BalancePart<unknown>;
  /** False while the app still learns which builder exchanges to read. */
  discovered: boolean;
  /** False when spot is not loaded (for example in the copy-trade sheet). */
  includesSpot: boolean;
}

export function traderDexStateKey(address: string | undefined, dex: string) {
  return ["trader", address, "dexState", dex] as const;
}

export function traderSpotStateKey(address: string | undefined) {
  return ["trader", address, "spotState"] as const;
}

function part<T>(query: UseQueryResult<T>, enabled = true): BalancePart<T> {
  return {
    // A query that is not needed counts as done, so it never holds a loading state.
    status: enabled ? query.status : "success",
    data: query.data,
    refetch: () => void query.refetch(),
  };
}

interface Options {
  /** False keeps every query idle. */
  enabled?: boolean;
  /** False skips the spot balances and the token map. */
  spot?: boolean;
}

/** The address must be lower-case. */
export function useAccountBalances(
  address: string | undefined,
  { enabled = true, spot: includeSpot = true }: Options = {},
): AccountBalances {
  const active = enabled && address !== undefined;

  const perpDexs = useQuery({
    queryKey: ["perpDexs"],
    queryFn: ({ signal }) => getPerpDexs({ signal }),
    staleTime: PERP_DEXS_STALE_MS,
    enabled: active,
  });
  const allDexes = useMemo(
    () => (perpDexs.data ? perpDexs.data.map((dex) => dex.name) : null),
    [perpDexs.data],
  );
  // Fills and the ledger are needed only when the list is long or did not load.
  const needSignals = perpDexs.isError || (allDexes !== null && !queriesAllDexes(allDexes));

  const main = useTraderState(address, { enabled: active });
  const fills = useTraderFills(address, { enabled: active && needSignals });
  const ledger = useQuery({
    queryKey: ["trader", address, "ledgerDexes"],
    queryFn: ({ signal }) => {
      // `enabled` below keeps this from running without an address.
      if (!address) throw new Error("No address");
      return getLedgerDexes(address, { signal });
    },
    staleTime: LEDGER_STALE_MS,
    enabled: active && needSignals,
  });

  const settled = (status: PartStatus) => status !== "pending";
  const discovered =
    settled(perpDexs.status) && (!needSignals || (settled(fills.status) && settled(ledger.status)));

  const fillCoins = useMemo(
    () => (fills.data ? [...new Set(fills.data.map((fill) => fill.coin))] : []),
    [fills.data],
  );
  const dexNames = useMemo(
    () =>
      perpDexs.isPending
        ? []
        : discoverDexes({ allDexes, fillCoins, ledgerDexes: ledger.data ?? [] }),
    [perpDexs.isPending, allDexes, fillCoins, ledger.data],
  );

  const combineDexes = useCallback(
    (results: UseQueryResult<ClearinghouseState>[]): DexPart[] =>
      results.map((result, index) => ({
        dex: dexNames[index] ?? "",
        ...part(result),
      })),
    [dexNames],
  );
  const dexes = useQueries({
    queries: dexNames.map((dex) => ({
      queryKey: traderDexStateKey(address, dex),
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        // `enabled` below keeps this from running without an address.
        if (!address) throw new Error("No address");
        return getClearinghouseState(address, { dex, signal });
      },
      staleTime: PART_REFRESH_MS,
      refetchInterval: PART_REFRESH_MS,
      enabled: active,
    })),
    combine: combineDexes,
  });

  const spotQuery = useQuery({
    queryKey: traderSpotStateKey(address),
    queryFn: ({ signal }) => {
      // `enabled` below keeps this from running without an address.
      if (!address) throw new Error("No address");
      return getSpotClearinghouseState(address, { signal });
    },
    staleTime: PART_REFRESH_MS,
    refetchInterval: PART_REFRESH_MS,
    enabled: active && includeSpot,
  });
  const tokenMap = useSpotTokenMap(active && includeSpot);
  const abstraction = useQuery({
    queryKey: ["trader", address, "abstraction"],
    queryFn: ({ signal }) => {
      // `enabled` below keeps this from running without an address.
      if (!address) throw new Error("No address");
      return getUserAbstraction(address, { signal });
    },
    staleTime: ABSTRACTION_STALE_MS,
    enabled: active && includeSpot,
  });

  const dexStates = useMemo(
    () =>
      dexes.flatMap((entry): DexState[] =>
        entry.data ? [{ dex: entry.dex, state: entry.data }] : [],
      ),
    [dexes],
  );

  return {
    main: part(main),
    dexes,
    dexStates,
    spot: part(spotQuery, includeSpot),
    tokenMap: part(tokenMap, includeSpot),
    abstraction: part(abstraction, includeSpot),
    perpDexs: part(perpDexs),
    ledger: part(ledger, needSignals),
    discovered,
    includesSpot: includeSpot,
  };
}

/** True while any part of the first load is still running. */
export function isLoadingBalances(balances: AccountBalances): boolean {
  return (
    balances.main.status === "pending" ||
    balances.spot.status === "pending" ||
    balances.abstraction.status === "pending" ||
    balances.tokenMap.status === "pending" ||
    !balances.discovered ||
    balances.dexes.some((entry) => entry.status === "pending")
  );
}

const NO_BALANCES: readonly SpotBalance[] = [];

/**
 * The live mids of some spot pairs. It listens only to these pairs, and the
 * snapshot is a string, so React re-renders only when one of them changes.
 */
function useSpotMids(pairs: readonly string[]): ReadonlyMap<string, number> {
  const key = pairs.join("|");
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = pairs.map((pair) => midsStore.subscribe(pair, listener));
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    // `key` holds the same pairs as `pairs`, so a new array with equal pairs keeps the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const getSnapshot = useCallback(
    () => pairs.map((pair) => midsStore.get(pair) ?? "").join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "");
  return useMemo(() => {
    const mids = new Map<string, number>();
    const values = snapshot.split("|");
    pairs.forEach((pair, index) => {
      const text = values[index];
      if (text !== undefined && text !== "") mids.set(pair, Number(text));
    });
    return mids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, key]);
}

export interface LiveAccountSummary {
  summary: AccountSummary;
  spotRows: SpotRow[];
  rows: BalanceRow[];
}

/**
 * The account summary and the balance rows at live spot mids. Use it in a
 * small leaf (a stat cell, the Balances panel): it re-renders on every tick
 * of the address's spot pairs.
 */
export function useLiveAccountSummary(balances: AccountBalances): LiveAccountSummary {
  const spotBalances = balances.spot.data ?? NO_BALANCES;
  const tokens = balances.tokenMap.data?.tokens;
  const pairs = useMemo(() => spotPairsOf(spotBalances, tokens), [spotBalances, tokens]);
  const mids = useSpotMids(pairs);
  const main = balances.main.data;
  const { dexStates } = balances;
  const unified = isUnifiedAbstraction(balances.abstraction.data);
  return useMemo(() => {
    const spotRows = priceSpotBalances(spotBalances, tokens, (pair) => mids.get(pair));
    const summary = summarizeAccount({ main, dexStates, spotRows, unified });
    return { summary, spotRows, rows: balanceRows(summary.perpsByDex, spotRows, unified) };
  }, [spotBalances, tokens, mids, main, dexStates, unified]);
}
