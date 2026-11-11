"use client";

import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  AssetRow,
  CopySummary,
  CopyTradeHeader,
  LeverageField,
  SizeField,
  SummaryRow,
} from "@/components/copy-trade/CopyTradeFields";
import type { CopyTradePrefill } from "@/components/copy-trade/CopyTradeProvider";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { forgetAgent } from "@/hooks/useAgent";
import { useTestnetMeta } from "@/hooks/useTestnetMeta";
import { useTestnetMid } from "@/hooks/useTestnetMids";
import { useApproveAgent, usePlaceTestnetOrder, type OrderPhase } from "@/hooks/useTradingActions";
import { useTradingSession } from "@/hooks/useTradingSession";
import { displaySymbol } from "@/lib/assets";
import {
  DEFAULT_SIZE_USD,
  clampSizeUsd,
  initialLeverage,
  resolveMaxLeverage,
} from "@/lib/calc/copyTrade";
import { EMPTY_VALUE, formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { PositionSide } from "@/lib/hyperliquid/schemas";
import { TESTNET, testnetExplorerUrl } from "@/lib/trading/config";
import type { TradingError } from "@/lib/trading/errors";
import { clampLeverage, findAsset, orderBlockReason, type OrderResult } from "@/lib/trading/order";

import { ConnectWalletPopover } from "./ConnectWallet";
import { TradingSteps } from "./TradingSteps";
import { TestnetBadge } from "./WalletButton";

export const TESTNET_CONFIRM_LABEL = "Place testnet order";

const PHASE_LABEL: Record<Exclude<OrderPhase, null>, string> = {
  leverage: "Setting leverage…",
  order: "Placing order…",
};

const LINK = "rounded-sm text-brand underline underline-offset-2 hover:text-foreground";

/**
 * The copy-trade form of the testnet build. Same fields as the demo; the
 * prices, the leverage limit and the balance come from Hyperliquid testnet.
 * One primary button moves through the steps: connect, approve, order.
 */
export default function TestnetCopyTradeForm({
  prefill,
  open,
}: {
  prefill: CopyTradePrefill;
  open: boolean;
}) {
  const { coin } = prefill;
  const id = useId();
  const session = useTradingSession({ live: open });
  const meta = useTestnetMeta(open);
  const midQuery = useTestnetMid(coin, open);
  const approve = useApproveAgent(session.address);
  const place = usePlaceTestnetOrder(session.address, session.agent);

  const asset = meta.data ? findAsset(meta.data, coin) : null;
  const maxLeverage = asset ? asset.maxLeverage : resolveMaxLeverage(prefill.maxLeverage);
  const [side, setSide] = useState<PositionSide>(prefill.side);
  const [sizeUsd, setSizeUsd] = useState(() => clampSizeUsd(prefill.sizeUsd ?? DEFAULT_SIZE_USD));
  const [wantedLeverage, setLeverage] = useState(() =>
    initialLeverage(prefill.leverage, resolveMaxLeverage(prefill.maxLeverage)),
  );
  const leverage = clampLeverage(wantedLeverage, maxLeverage);
  const [result, setResult] = useState<OrderResult | null>(null);

  const mid = midQuery.data;
  const position = session.account.data?.positions.find((entry) => entry.coin === coin);
  const step = session.status === "disconnected" ? 1 : session.status === "connected" ? 2 : 3;

  let blockReason: string | null;
  if (meta.isPending) blockReason = "Loading testnet markets.";
  else if (meta.isError) blockReason = "Testnet markets did not load.";
  else if (midQuery.isError && mid === undefined) blockReason = "The testnet price did not load.";
  else if (session.account.isError) blockReason = "The testnet balance did not load.";
  else
    blockReason = orderBlockReason({
      asset,
      mid,
      balanceUsd: session.balanceUsd,
      sizeUsd,
      leverage,
    });

  const retry =
    meta.isError || midQuery.isError || session.account.isError
      ? () => {
          void meta.refetch();
          void midQuery.refetch();
          void session.account.refetch();
        }
      : undefined;

  function onPlaceOrder() {
    if (!asset || blockReason) return;
    setResult(null);
    place.mutate(
      { asset, side, sizeUsd, leverage, position },
      {
        onSuccess: (outcome) => {
          setResult(outcome);
          if (outcome.kind === "filled") {
            toast(
              `Filled ${formatSize(outcome.totalSz)} ${displaySymbol(coin)} at ${formatPrice(outcome.avgPx)} on testnet`,
            );
          }
        },
      },
    );
  }

  function onForgetAgent() {
    if (!session.address) return;
    forgetAgent(session.address);
    setResult(null);
    approve.reset();
    place.reset();
  }

  const error: TradingError | null = approve.error ?? place.error;

  let primary: ReactNode;
  if (step === 1) {
    primary = (
      <ConnectWalletPopover side="top" align="center">
        <PrimaryButton disabled={session.isConnecting}>
          {session.isConnecting ? <Spinner /> : null}
          Connect wallet
        </PrimaryButton>
      </ConnectWalletPopover>
    );
  } else if (step === 2) {
    primary = (
      <PrimaryButton
        onClick={() => {
          place.reset();
          approve.mutate();
        }}
        disabled={approve.isPending}
      >
        {approve.isPending ? <Spinner /> : null}
        {approve.isPending ? "Waiting for signature…" : "Approve agent"}
      </PrimaryButton>
    );
  } else {
    primary = (
      <PrimaryButton
        onClick={onPlaceOrder}
        disabled={place.isPending || blockReason !== null}
        aria-describedby={blockReason ? `${id}-reason` : undefined}
      >
        {place.isPending ? <Spinner /> : null}
        {place.isPending && place.phase ? PHASE_LABEL[place.phase] : TESTNET_CONFIRM_LABEL}
      </PrimaryButton>
    );
  }

  return (
    <>
      <CopyTradeHeader badge={<TestnetBadge />} />
      <SheetDescription className="sr-only">
        Copy this trade on Hyperliquid testnet. Connect a wallet, approve a testnet agent once, then
        place an order. No mainnet order is possible.
      </SheetDescription>

      <div className="flex flex-col gap-3 p-4">
        <AssetRow coin={coin} sideName={`${id}-side`} side={side} onSideChange={setSide} />
        <SizeField id={id} value={sizeUsd} onChange={setSizeUsd} />
        <LeverageField value={leverage} max={maxLeverage} onChange={setLeverage} />
        <CopySummary
          coin={coin}
          mark={mid}
          markLabel="Testnet mid"
          sizeUsd={sizeUsd}
          leverage={leverage}
          side={side}
          maxLeverage={asset?.maxLeverage ?? prefill.maxLeverage}
        >
          {step === 3 ? (
            <SummaryRow label="Testnet balance" testId="testnet-balance">
              {session.balanceUsd === undefined ? EMPTY_VALUE : formatUsd(session.balanceUsd)}
            </SummaryRow>
          ) : null}
        </CopySummary>

        <section
          aria-label="Testnet trading"
          className="flex flex-col gap-2 rounded-md border px-3 pt-1 pb-2.5"
        >
          <TradingSteps current={step} />
          <StepText step={step} />
          {error ? <ErrorNotice error={error} /> : null}
          {result ? <ResultNotice result={result} coin={coin} address={session.address} /> : null}
        </section>
      </div>

      <SheetFooter className="gap-2 border-t px-4 pt-3 pb-4">
        {primary}
        {step === 3 && blockReason ? (
          <p
            id={`${id}-reason`}
            data-testid="order-block-reason"
            className="flex items-center justify-center gap-2 text-center text-2xs text-muted-foreground"
          >
            {blockReason}
            {retry ? (
              <button type="button" onClick={retry} className={LINK}>
                Retry
              </button>
            ) : null}
            {session.balanceUsd === 0 ? (
              <a
                href={TESTNET.faucetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
              >
                Get test USDC<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </p>
        ) : null}
        {session.agent ? (
          <div className="flex items-start justify-between gap-3 text-2xs text-faint">
            <p>
              The agent key lives only in this browser. It trades on testnet for this account and
              cannot withdraw. Forget agent removes it here. To deregister it, use the{" "}
              <a
                href={`${TESTNET.appUrl}/API`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                testnet API page<span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </p>
            <button
              type="button"
              data-testid="forget-agent"
              onClick={onForgetAgent}
              className="shrink-0 rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Forget agent
            </button>
          </div>
        ) : null}
      </SheetFooter>
    </>
  );
}

function PrimaryButton(props: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="lg"
      data-testid="copy-confirm"
      className="h-10 w-full text-sm font-semibold"
      {...props}
    />
  );
}

function Spinner() {
  return <Loader2Icon aria-hidden="true" className="size-4 motion-safe:animate-spin" />;
}

function StepText({ step }: { step: 1 | 2 | 3 }) {
  if (step === 1) {
    return (
      <p className="text-2xs text-muted-foreground">
        Connect a browser wallet. Slipstream never asks for your wallet key.
      </p>
    );
  }
  if (step === 2) {
    return (
      <p className="text-2xs text-muted-foreground">
        One signature approves a Slipstream agent: a testnet-only trading key that stays in this
        browser.
      </p>
    );
  }
  return (
    <p className="text-2xs text-muted-foreground">
      An IOC order at 1% through the testnet mid. Minimum $10. Estimates ignore fees.
    </p>
  );
}

function ErrorNotice({ error }: { error: TradingError }) {
  return (
    <p
      role="alert"
      data-testid="trading-error"
      data-kind={error.kind}
      className="text-2xs text-short"
    >
      {error.message}
      {error.kind === "unfunded" ? (
        <>
          {" "}
          <a href={TESTNET.faucetUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
            Get test USDC from the faucet<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </>
      ) : null}
    </p>
  );
}

function ResultNotice({
  result,
  coin,
  address,
}: {
  result: OrderResult;
  coin: string;
  address: string | undefined;
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
        Filled {formatSize(result.totalSz)} {displaySymbol(coin)} at {formatPrice(result.avgPx)}
      </span>
      {address ? (
        <a
          href={testnetExplorerUrl(address)}
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
