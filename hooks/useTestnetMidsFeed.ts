"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { getAllMidsOnce } from "@/lib/hyperliquid/client";
import { createMidsStore, type MidsStore } from "@/lib/hyperliquid/mids";
import { TESTNET } from "@/lib/trading/config";

const REFRESH_MS = 3_000;

/**
 * A mids store with testnet prices, for a MidsSourceProvider. It polls the
 * testnet `allMids` over REST every 3 s while mounted (the one shared
 * socket stays on mainnet). The query key is the copy-trade sheet's key,
 * so both share one request. Each mount gets its own store.
 */
export function useTestnetMidsFeed(): MidsStore {
  const [store] = useState(createMidsStore);
  const { data } = useQuery({
    queryKey: ["testnet", "allMids"],
    queryFn: ({ signal }) => getAllMidsOnce(TESTNET.infoUrl, { signal }),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS - 500,
  });
  useEffect(() => {
    if (data) store.ingest(data);
  }, [data, store]);
  return store;
}
