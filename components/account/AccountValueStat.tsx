"use client";

import { Stat, StatNote, StatValue } from "@/components/shared/Stat";
import {
  isLoadingBalances,
  useLiveAccountSummary,
  type AccountBalances,
} from "@/hooks/useAccountBalances";
import { formatUsd } from "@/lib/format";

/**
 * "Account value": every perp exchange plus priced spot, at live spot mids.
 * A small leaf, because it re-renders on every tick of the spot pairs.
 */
export function AccountValueStat({ balances }: { balances: AccountBalances }) {
  const { summary } = useLiveAccountSummary(balances);
  const loadingParts = isLoadingBalances(balances);
  const unpriced = summary.spotUnpricedCount;
  return (
    <Stat label="Account value" loading={balances.main.status === "pending"}>
      <StatValue>
        <span data-testid="account-total">{formatUsd(summary.totalUsd)}</span>
      </StatValue>
      <StatNote>
        {loadingParts ? (
          "Loading spot and builder exchanges"
        ) : summary.spotWaitingCount > 0 ? (
          // The socket sends the first mids within a few seconds.
          "Waiting for spot prices"
        ) : summary.unified ? (
          <span
            data-testid="account-split"
            title="Unified account: the perps margin is part of the spot USDC balance"
          >
            Unified · {formatUsd(summary.perpsUsd, { compact: true })} perps margin in spot
          </span>
        ) : (
          <span
            data-testid="account-split"
            title={
              unpriced > 0
                ? `${unpriced} spot ${unpriced === 1 ? "token has" : "tokens have"} no USD price`
                : undefined
            }
          >
            Perps {formatUsd(summary.perpsUsd, { compact: true })} · Spot{" "}
            {formatUsd(summary.spotUsd, { compact: true })}
          </span>
        )}
      </StatNote>
    </Stat>
  );
}
