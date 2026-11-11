"use client";

import { Panel } from "@/components/shared/Panel";
import { AssetIcon } from "@/components/shared/AssetIcon";
import { DexBadge } from "@/components/shared/DexBadge";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import { Button } from "@/components/ui/button";
import {
  isLoadingBalances,
  useLiveAccountSummary,
  type AccountBalances,
} from "@/hooks/useAccountBalances";
import { useHideSmallBalances } from "@/hooks/useHideSmallBalances";
import { isSmallBalance, USDC, type BalanceRow } from "@/lib/calc/balances";
import { EMPTY_VALUE, formatAmount, formatUsd } from "@/lib/format";
import type { SpotToken } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

const CELL = "px-3 text-right font-mono text-xs whitespace-nowrap tabular-nums";
/** Token amounts never show more decimals than this. */
const MAX_TOKEN_DECIMALS = 4;

interface PartError {
  id: string;
  message: string;
  retry: () => void;
}

/** One line per part that failed, so a failure never hides the parts that loaded. */
function partErrors(balances: AccountBalances): PartError[] {
  const errors: PartError[] = [];
  if (balances.main.status === "error") {
    errors.push({ id: "main", message: "Perps: failed to load", retry: balances.main.refetch });
  }
  for (const entry of balances.dexes) {
    if (entry.status === "error") {
      errors.push({
        id: `dex:${entry.dex}`,
        message: `${entry.dex}: failed to load`,
        retry: entry.refetch,
      });
    }
  }
  if (balances.spot.status === "error") {
    errors.push({ id: "spot", message: "Spot: failed to load", retry: balances.spot.refetch });
  }
  if (balances.tokenMap.status === "error") {
    errors.push({
      id: "token-map",
      message: "Spot prices: failed to load",
      retry: balances.tokenMap.refetch,
    });
  }
  if (balances.abstraction.status === "error") {
    errors.push({
      id: "abstraction",
      message: "Account mode: failed to load, so the total can count perps margin twice",
      retry: balances.abstraction.refetch,
    });
  }
  if (balances.perpDexs.status === "error") {
    errors.push({
      id: "perp-dexs",
      message: "Builder exchange list: failed to load",
      retry: balances.perpDexs.refetch,
    });
  }
  if (balances.ledger.status === "error") {
    errors.push({
      id: "ledger",
      message: "Transfers: failed to load, so a builder exchange can be missing",
      retry: balances.ledger.refetch,
    });
  }
  return errors;
}

function amountText(row: BalanceRow, tokens: Readonly<Record<string, SpotToken>> | undefined) {
  if (row.asset === USDC) return formatAmount(row.total, 2, 2);
  const token = tokens && Object.hasOwn(tokens, row.asset) ? tokens[row.asset] : undefined;
  const decimals = Math.min(token?.szDecimals ?? MAX_TOKEN_DECIMALS, MAX_TOKEN_DECIMALS);
  const text = formatAmount(row.total, decimals);
  // A dust balance (0.0001 HYPE) must not read as 0.
  if (row.total > 0 && text === "0") return `<${formatAmount(10 ** -decimals, decimals)}`;
  return text;
}

/**
 * Balances across the main perp exchange, every builder perp exchange
 * that the address uses, and spot. Spot tokens are priced with the live mid
 * of their USDC pair. Small balances (below $1) are hidden by default.
 */
export function BalancesPanel({
  balances,
  title = "Balances",
  titleId = "balances-title",
  className,
}: {
  balances: AccountBalances;
  title?: string;
  titleId?: string;
  className?: string;
}) {
  const { summary, rows } = useLiveAccountSummary(balances);
  const [hideSmall, setHideSmall] = useHideSmallBalances();
  const loading = isLoadingBalances(balances);
  const errors = partErrors(balances);
  const tokens = balances.tokenMap.data?.tokens;

  const visible = hideSmall ? rows.filter((row) => !isSmallBalance(row)) : rows;
  const hiddenCount =
    rows.filter((row) => row.total !== 0).length - visible.filter((row) => row.total !== 0).length;
  const nothingLoaded = balances.main.data === undefined && balances.spot.data === undefined;

  let body: React.ReactNode;
  if (loading && rows.length === 0 && errors.length === 0) {
    body = <SkeletonRows rows={3} label="Loading balances" />;
  } else if (
    nothingLoaded &&
    balances.main.status === "error" &&
    balances.spot.status !== "pending"
  ) {
    body = (
      <ErrorState
        title="Balances did not load"
        description="The Hyperliquid info service did not answer."
        onRetry={() => {
          balances.main.refetch();
          balances.spot.refetch();
        }}
      />
    );
  } else if (visible.length === 0 && errors.length === 0 && !loading) {
    body = (
      <EmptyState
        title="No balances"
        description={
          hiddenCount > 0
            ? `${hiddenCount} small ${hiddenCount === 1 ? "balance is" : "balances are"} hidden.`
            : "This address holds no USDC or tokens on this network."
        }
      >
        {hiddenCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="mt-1"
            onClick={() => setHideSmall(false)}
          >
            Show all
          </Button>
        ) : null}
      </EmptyState>
    );
  } else {
    body = (
      // "relative" keeps the sr-only caption inside the scroll box.
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[300px] border-collapse">
          <caption className="sr-only">
            Balances on every perp exchange and in spot. Spot USD values use live mids.
          </caption>
          <thead>
            <tr className="h-8 border-b text-2xs tracking-wide text-muted-foreground uppercase">
              <th
                scope="col"
                className="sticky left-0 z-[1] bg-background px-3 text-left font-normal max-md:border-r"
              >
                Asset
              </th>
              <th scope="col" className="px-3 text-left font-normal max-sm:hidden">
                Where
              </th>
              <th scope="col" className="px-3 text-right font-normal">
                Total
              </th>
              <th scope="col" className="px-3 text-right font-normal whitespace-nowrap">
                USD value
              </th>
            </tr>
          </thead>
          <tbody data-testid="balance-rows">
            {errors.map((error) => (
              <tr key={error.id} data-testid="balance-error" className="h-9 border-b">
                <td colSpan={4} className="px-3">
                  <span role="alert" className="flex items-center gap-2 text-2xs text-short">
                    {error.message}
                    <Button type="button" variant="outline" size="xs" onClick={error.retry}>
                      Retry
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
            {visible.map((row) => (
              <BalanceRowView key={row.id} row={row} amount={amountText(row, tokens)} />
            ))}
            {loading ? (
              <tr className="h-9 border-b">
                <td colSpan={4} className="px-3 text-2xs text-faint" role="status">
                  Loading more balances…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Panel
      title={title}
      titleId={titleId}
      titleOnMobile
      meta={
        loading ? null : (
          <span className="font-mono tabular-nums" data-testid="balances-total">
            {formatUsd(summary.totalUsd)}
          </span>
        )
      }
      actions={
        <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground select-none hover:text-foreground">
          <input
            type="checkbox"
            checked={hideSmall}
            onChange={(event) => setHideSmall(event.target.checked)}
            data-testid="hide-small-balances"
            className="size-3.5 rounded-sm accent-brand"
          />
          Hide small
          {hideSmall && hiddenCount > 0 ? (
            <span className="font-mono text-faint tabular-nums">({hiddenCount})</span>
          ) : null}
        </label>
      }
      className={className}
    >
      <div data-testid="balances-panel">{body}</div>
    </Panel>
  );
}

function BalanceRowView({ row, amount }: { row: BalanceRow; amount: string }) {
  const where = row.kind === "spot" ? "Spot" : "Perps";
  const showAvailable = row.available !== null && Math.abs(row.available - row.total) >= 0.005;
  return (
    <tr
      data-testid="balance-row"
      data-id={row.id}
      className="group h-9 border-b transition-colors hover:bg-surface-hover"
    >
      <th
        scope="row"
        className="sticky left-0 z-[1] bg-background px-3 text-left text-xs font-medium whitespace-nowrap text-foreground transition-colors group-hover:bg-surface-hover max-md:border-r"
      >
        <span className="inline-flex items-center gap-1.5">
          <AssetIcon coin={row.asset} monogramOnly={row.kind === "spot" && row.asset !== USDC} />
          <span className="flex flex-col leading-tight">
            {row.asset}
            {/* Below sm the Where column is hidden; its text sits under the asset. */}
            <span className="inline-flex items-center gap-1 text-2xs font-normal text-faint sm:hidden">
              {where}
              {row.dex ? <DexBadge dex={row.dex} /> : null}
            </span>
          </span>
        </span>
      </th>
      <td
        className="px-3 text-xs whitespace-nowrap text-muted-foreground max-sm:hidden"
        data-testid="balance-where"
      >
        <span className="inline-flex items-center gap-1.5">
          {where}
          {row.dex ? <DexBadge dex={row.dex} /> : null}
        </span>
      </td>
      <td className={cn(CELL, "text-foreground")} data-testid="balance-total">
        {showAvailable && row.available !== null ? (
          <span className="flex flex-col items-end leading-tight">
            <span>{amount}</span>
            <span className="text-2xs text-faint">
              {formatAmount(row.available, 2, 2)} available
            </span>
          </span>
        ) : (
          amount
        )}
      </td>
      <td className={cn(CELL, "text-foreground")} data-testid="balance-usd">
        {row.usdValue === null ? (
          <span className="text-faint" title={row.pair === null ? "No USDC pair" : "No price yet"}>
            {EMPTY_VALUE}
            <span className="sr-only">{row.pair === null ? " No USDC pair" : " No price yet"}</span>
          </span>
        ) : row.inTotal ? (
          formatUsd(row.usdValue)
        ) : (
          <span
            className="text-faint"
            title="Unified account: this margin is part of the spot USDC balance"
          >
            {formatUsd(row.usdValue)}
            <span className="sr-only"> (part of the spot USDC balance)</span>
          </span>
        )}
      </td>
    </tr>
  );
}
