"use client";

import { ExternalLinkIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { displaySymbol } from "@/lib/assets";
import { formatPrice, formatSize } from "@/lib/format";
import { explorerAddressUrl } from "@/lib/network";
import { agentRemainingMs, formatRemaining, type StoredAgent } from "@/lib/trading/agent";
import { NETWORK, TRADING } from "@/lib/trading/config";
import type { TradingError } from "@/lib/trading/errors";
import type { OrderResult } from "@/lib/trading/order";

/*
 * The parts that the copy-trade sheet and the manage-position sheet share in
 * a trading build: the primary button, the risk panel, the agent block and
 * the error and result notices.
 */

export const LINK = "rounded-sm text-brand underline underline-offset-2 hover:text-foreground";
export const QUIET_LINK =
  "rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground";

export function PrimaryButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="lg"
      data-testid="copy-confirm"
      className={className ?? "h-10 w-full text-sm font-semibold"}
      {...props}
    />
  );
}

export function Spinner() {
  return <Loader2Icon aria-hidden="true" className="size-4 motion-safe:animate-spin" />;
}

/** The faucet on testnet; on mainnet a link to deposit on Hyperliquid. */
export function FundsLink({ label }: { label?: string }) {
  const href = TRADING.faucetUrl ?? TRADING.appUrl;
  const text = label ?? (TRADING.faucetUrl ? "Get test USDC" : "Deposit on Hyperliquid");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="funds-link"
      className={LINK}
    >
      {text}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Mainnet only: the one-time risk acknowledgement before the first approval. */
export function RiskPanel({
  id,
  checked,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      id={`${id}-risk`}
      data-testid="risk-panel"
      className="flex flex-col gap-2 rounded-sm border border-brand/40 bg-brand-dim px-2.5 py-2 text-2xs text-foreground"
    >
      <p className="font-medium">Before you trade on mainnet</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-muted-foreground">
        <li>Orders use real funds on Hyperliquid mainnet. A loss is real.</li>
        <li>
          The agent key lives in this browser for 24 h. Anyone with access to this browser profile
          can trade with it. It cannot withdraw.
        </li>
        <li>Slipstream is unofficial, unaudited software. It gives no financial advice.</li>
      </ul>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          data-testid="risk-checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="size-3.5 accent-(--color-brand)"
        />
        I understand
      </label>
    </div>
  );
}

export function AgentBlock({
  agent,
  now,
  onForget,
}: {
  agent: StoredAgent;
  now: number;
  onForget: () => void;
}) {
  return (
    <div data-testid="agent-block" className="flex flex-col gap-1 text-2xs text-faint">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span data-testid="agent-expiry" className="text-muted-foreground">
          Agent key expires in {formatRemaining(agentRemainingMs(agent, now))}
        </span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            data-testid="forget-agent"
            onClick={onForget}
            className={QUIET_LINK}
          >
            Forget agent
          </button>
          <a
            href={`${TRADING.appUrl}/API`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="revoke-agent"
            className={QUIET_LINK}
          >
            Revoke on Hyperliquid<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </span>
      </div>
      <p>
        The agent key lives only in this browser. It trades on {NETWORK} for this account and cannot
        withdraw. Forget agent removes it here; revoke it on Hyperliquid to end it on the exchange.
      </p>
    </div>
  );
}

export function ErrorNotice({ error }: { error: TradingError }) {
  const exchangeText =
    error.exchangeMessage && error.exchangeMessage !== error.message ? error.exchangeMessage : null;
  return (
    <div role="alert" data-testid="trading-error" data-kind={error.kind} className="text-2xs">
      <p className="text-short">
        {error.message}
        {error.kind === "unfunded" ? (
          <>
            {" "}
            <FundsLink
              label={TRADING.faucetUrl ? "Get test USDC from the faucet" : "Deposit on Hyperliquid"}
            />
          </>
        ) : null}
      </p>
      {exchangeText ? (
        <p data-testid="trading-error-exchange" className="mt-0.5 font-mono break-all text-faint">
          Exchange: {exchangeText}
        </p>
      ) : null}
    </div>
  );
}

export function ResultNotice({
  result,
  coin,
  address,
  verb = "Filled",
}: {
  result: OrderResult;
  coin: string;
  address: string | undefined;
  /** The first word of a fill line: "Filled" for an order, "Closed" for a close. */
  verb?: string;
}) {
  if (result.kind === "error") {
    return (
      <p role="alert" data-testid="order-result" data-kind="error" className="text-2xs text-short">
        {result.message}
      </p>
    );
  }
  if (result.kind === "resting") {
    return (
      <p
        role="status"
        data-testid="order-result"
        data-kind="resting"
        className="text-2xs text-foreground"
      >
        Order resting (oid {result.oid}).
      </p>
    );
  }
  return (
    <p
      role="status"
      data-testid="order-result"
      data-kind="filled"
      className="flex items-center justify-between gap-2 font-mono text-2xs text-long"
    >
      <span>
        {verb} {formatSize(result.totalSz)} {displaySymbol(coin)} at {formatPrice(result.avgPx)}
      </span>
      {address ? (
        <a
          href={explorerAddressUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-sans text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Explorer
          <ExternalLinkIcon aria-hidden="true" className="size-3" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
    </p>
  );
}
