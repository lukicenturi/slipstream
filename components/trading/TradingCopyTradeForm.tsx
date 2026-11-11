"use client";

import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  AssetRow,
  CopySummary,
  CopyTradeHeader,
  formatSizeUsd,
  LeverageField,
  SizeField,
  SummaryRow,
} from "@/components/copy-trade/CopyTradeFields";
import { BuilderUsdcNote } from "@/components/account/BuilderUsdcNote";
import type { CopyTradePrefill } from "@/components/copy-trade/CopyTradeProvider";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { useAccountBalances } from "@/hooks/useAccountBalances";
import { forgetAgent } from "@/hooks/useAgent";
import { useMid } from "@/hooks/useMid";
import { useNow } from "@/hooks/useNow";
import { useRiskAck } from "@/hooks/useRiskAck";
import { useTradingMeta } from "@/hooks/useTradingMeta";
import { useApproveAgent, usePlaceOrder, type OrderPhase } from "@/hooks/useTradingActions";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useTradingSettings } from "@/hooks/useTradingSettings";
import { displaySymbol } from "@/lib/assets";
import { builderDexWithUsdc, perpAccounts } from "@/lib/calc/balances";
import { DEFAULT_SIZE_USD, initialLeverage, resolveMaxLeverage } from "@/lib/calc/copyTrade";
import { estimateLiquidation, estimateMargin } from "@/lib/calc/liquidation";
import { EMPTY_VALUE, formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { PerpAsset, PositionSide } from "@/lib/hyperliquid/schemas";
import { explorerAddressUrl } from "@/lib/network";
import { agentRemainingMs, formatRemaining, type StoredAgent } from "@/lib/trading/agent";
import {
  MIN_ORDER_USD,
  NETWORK,
  networkLabel,
  TRADING,
  TRADING_LIMITS,
  type Network,
} from "@/lib/trading/config";
import type { TradingError } from "@/lib/trading/errors";
import {
  buildIocOrder,
  clampLeverage,
  findAsset,
  orderBlockReason,
  type OrderResult,
} from "@/lib/trading/order";
import { isAcknowledged } from "@/lib/trading/riskAck";
import { sizeLimitUsd } from "@/lib/trading/settings";
import { cn } from "@/lib/utils";

import { ConnectWalletPopover } from "./ConnectWallet";
import { NetworkBadge } from "./NetworkBadge";
import { TradingSteps } from "./TradingSteps";

/** The label of the one button that sends an order. */
export function confirmLabel(network: Network): string {
  return `Place ${network} order`;
}

const PHASE_LABEL: Record<Exclude<OrderPhase, null>, string> = {
  leverage: "Setting leverage…",
  order: "Placing order…",
};

/** The trading sheet moves the size in steps of $10 (the exchange minimum). */
const SIZE_STEP_USD = 10;

const LINK = "rounded-sm text-brand underline underline-offset-2 hover:text-foreground";
const QUIET_LINK =
  "rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground";

/**
 * The copy-trade form of a trading build, on the build's network (mainnet
 * or testnet). Same fields as the demo; the prices, the leverage limit and
 * the balance come from that network. The mid is the live mid of the shared
 * socket. One primary button moves through the steps: connect, approve,
 * review, place. On mainnet a risk acknowledgement comes before the
 * approval. The size is capped by the trading settings.
 */
export default function TradingCopyTradeForm({
  prefill,
  open,
}: {
  prefill: CopyTradePrefill;
  open: boolean;
}) {
  const { coin } = prefill;
  const id = useId();
  const now = useNow();
  const session = useTradingSession({ live: open });
  const meta = useTradingMeta(open);
  const mid = useMid(coin);
  const approve = useApproveAgent(session.address);
  const place = usePlaceOrder(session.address, session.agent);
  const { settings, setMaxOrderUsd } = useTradingSettings();
  const riskAck = useRiskAck();

  const asset = meta.data ? findAsset(meta.data, coin) : null;
  const maxLeverage = asset ? asset.maxLeverage : resolveMaxLeverage(prefill.maxLeverage);
  const [side, setSideState] = useState<PositionSide>(prefill.side);
  const [wantedSizeUsd, setWantedSizeUsd] = useState(() => prefill.sizeUsd ?? DEFAULT_SIZE_USD);
  const [wantedLeverage, setLeverageState] = useState(() =>
    initialLeverage(prefill.leverage, resolveMaxLeverage(prefill.maxLeverage)),
  );
  const [reviewing, setReviewing] = useState(false);
  const [riskChecked, setRiskChecked] = useState(false);
  const leverage = clampLeverage(wantedLeverage, maxLeverage);
  const [result, setResult] = useState<OrderResult | null>(null);

  // The size slider stops at the cap, and at balance x leverage when the balance is known.
  const sizeMax = sizeLimitUsd({
    maxOrderUsd: settings.maxOrderUsd,
    balanceUsd: session.balanceUsd,
    leverage,
  });
  const sizeUsd = Math.min(sizeMax, Math.max(MIN_ORDER_USD, wantedSizeUsd));

  // Any change to the order leaves the review, so the review always shows what is sent.
  function setSide(next: PositionSide) {
    setSideState(next);
    setReviewing(false);
  }
  function setSizeUsd(next: number) {
    setWantedSizeUsd(next);
    setReviewing(false);
  }
  function setLeverage(next: number) {
    setLeverageState(next);
    setReviewing(false);
  }

  const position = session.account.data?.positions.find((entry) => entry.coin === coin);
  // Orders use the main perps USDC. When it is 0, look for USDC in a builder exchange.
  const noMainUsdc = session.balanceUsd !== undefined && session.balanceUsd < 0.01;
  const balances = useAccountBalances(session.address, {
    enabled: open && noMainUsdc,
    spot: false,
  });
  const builderUsdc = noMainUsdc
    ? builderDexWithUsdc(perpAccounts(undefined, balances.dexStates))
    : null;
  const step = session.status === "disconnected" ? 1 : session.status === "connected" ? 2 : 3;
  // Mainnet only: the risk panel shows before the first approval, and again after 30 days.
  const needsRiskAck = NETWORK === "mainnet" && step === 2 && !isAcknowledged(riskAck.value, now);

  let blockReason: string | null;
  if (meta.isPending) blockReason = `Loading ${NETWORK} markets.`;
  else if (meta.isError) blockReason = `${networkLabel(NETWORK)} markets did not load.`;
  else if (session.account.isError) blockReason = `The ${NETWORK} balance did not load.`;
  else
    blockReason = orderBlockReason({
      network: NETWORK,
      asset,
      mid,
      balanceUsd: session.balanceUsd,
      sizeUsd,
      leverage,
      maxOrderUsd: settings.maxOrderUsd,
    });

  const retry =
    meta.isError || session.account.isError
      ? () => {
          void meta.refetch();
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
              `Filled ${formatSize(outcome.totalSz)} ${displaySymbol(coin)} at ${formatPrice(outcome.avgPx)} on ${NETWORK}`,
            );
          }
        },
        onSettled: () => setReviewing(false),
      },
    );
  }

  function onForgetAgent() {
    if (!session.address) return;
    forgetAgent(session.address);
    setResult(null);
    setReviewing(false);
    approve.reset();
    place.reset();
  }

  const error: TradingError | null = approve.error ?? place.error;
  const showReview = step === 3 && reviewing;

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
  } else if (step === 2 && needsRiskAck) {
    primary = (
      <PrimaryButton
        data-testid="risk-continue"
        onClick={() => riskAck.acknowledge()}
        disabled={!riskChecked}
        aria-describedby={`${id}-risk`}
      >
        Continue
      </PrimaryButton>
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
  } else if (!showReview) {
    primary = (
      <PrimaryButton
        data-testid="review-order"
        onClick={() => {
          place.reset();
          setResult(null);
          setReviewing(true);
        }}
        disabled={blockReason !== null}
        aria-describedby={blockReason ? `${id}-reason` : undefined}
      >
        Review order
      </PrimaryButton>
    );
  } else {
    primary = (
      <div className="flex w-full gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          data-testid="review-back"
          className="h-10 w-24 shrink-0 text-sm"
          onClick={() => setReviewing(false)}
          disabled={place.isPending}
        >
          Back
        </Button>
        <PrimaryButton
          onClick={onPlaceOrder}
          disabled={place.isPending || blockReason !== null}
          aria-describedby={blockReason ? `${id}-reason` : undefined}
          className="h-10 min-w-0 flex-1 text-sm font-semibold"
        >
          {place.isPending ? <Spinner /> : null}
          {place.isPending && place.phase ? PHASE_LABEL[place.phase] : confirmLabel(NETWORK)}
        </PrimaryButton>
      </div>
    );
  }

  return (
    <>
      <CopyTradeHeader badge={<NetworkBadge network={NETWORK} />} />
      <SheetDescription className="sr-only">
        {NETWORK === "mainnet"
          ? "Copy this trade on Hyperliquid mainnet with real funds. Connect a wallet, confirm the risks, approve an agent, review the order, then place it."
          : "Copy this trade on Hyperliquid testnet with test funds. Connect a wallet, approve a testnet agent once, review the order, then place it."}
      </SheetDescription>

      <div className="flex flex-col gap-3 p-4">
        <AssetRow coin={coin} sideName={`${id}-side`} side={side} onSideChange={setSide} />
        <SizeField
          id={id}
          value={sizeUsd}
          onChange={setSizeUsd}
          min={MIN_ORDER_USD}
          max={sizeMax}
          step={SIZE_STEP_USD}
        >
          <SizeCap
            id={id}
            network={NETWORK}
            maxOrderUsd={settings.maxOrderUsd}
            onSave={(value) => {
              setMaxOrderUsd(value);
              setReviewing(false);
            }}
          />
        </SizeField>
        <LeverageField value={leverage} max={maxLeverage} onChange={setLeverage} />
        {showReview && asset && mid !== undefined ? (
          <ReviewCard
            network={NETWORK}
            asset={asset}
            coin={coin}
            side={side}
            sizeUsd={sizeUsd}
            leverage={leverage}
            mid={mid}
          />
        ) : (
          <CopySummary
            coin={coin}
            mark={mid}
            markLabel="Mid"
            sizeUsd={sizeUsd}
            leverage={leverage}
            side={side}
            maxLeverage={asset?.maxLeverage ?? prefill.maxLeverage}
          >
            {step === 3 ? (
              <SummaryRow label="Balance" testId="trading-balance">
                {session.balanceUsd === undefined ? EMPTY_VALUE : formatUsd(session.balanceUsd)}
              </SummaryRow>
            ) : null}
          </CopySummary>
        )}

        <section
          aria-label={`${networkLabel(NETWORK)} trading`}
          className="flex flex-col gap-2 rounded-md border px-3 pt-1 pb-2.5"
        >
          <TradingSteps current={step} />
          {needsRiskAck ? (
            <RiskPanel id={id} checked={riskChecked} onCheckedChange={setRiskChecked} />
          ) : (
            <StepText step={step} network={NETWORK} />
          )}
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
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-center text-2xs text-muted-foreground"
          >
            {blockReason}
            {retry ? (
              <button type="button" onClick={retry} className={LINK}>
                Retry
              </button>
            ) : null}
            {builderUsdc?.dex ? (
              <span data-testid="sheet-transfer-note">
                <BuilderUsdcNote dex={builderUsdc.dex} linkClassName={LINK} />
              </span>
            ) : session.balanceUsd === 0 ? (
              <FundsLink />
            ) : null}
          </p>
        ) : null}
        {session.agent ? (
          <AgentBlock agent={session.agent} now={now} onForget={onForgetAgent} />
        ) : null}
      </SheetFooter>
    </>
  );
}

function PrimaryButton({ className, ...props }: React.ComponentProps<typeof Button>) {
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

function Spinner() {
  return <Loader2Icon aria-hidden="true" className="size-4 motion-safe:animate-spin" />;
}

/** The faucet on testnet; on mainnet a link to deposit on Hyperliquid. */
function FundsLink({ label }: { label?: string }) {
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

/** "Cap $500 · change", with a small inline editor for the per-order cap. */
function SizeCap({
  id,
  network,
  maxOrderUsd,
  onSave,
}: {
  id: string;
  network: Network;
  maxOrderUsd: number;
  onSave: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const hardMax = TRADING_LIMITS[network].hardMaxOrderUsd;
  const parsed = Number(draft.replace(/[$,\s]/g, ""));
  const valid = draft.trim() !== "" && Number.isFinite(parsed);

  if (!editing) {
    return (
      <p className="mt-1.5 flex items-center gap-1 text-2xs text-muted-foreground">
        <span data-testid="size-cap">Cap {formatSizeUsd(maxOrderUsd)} per order</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          data-testid="size-cap-change"
          className={QUIET_LINK}
          onClick={() => {
            setDraft(String(maxOrderUsd));
            setEditing(true);
          }}
        >
          change<span className="sr-only"> the per-order cap</span>
        </button>
      </p>
    );
  }

  return (
    <form
      className="mt-1.5 flex flex-wrap items-center gap-1.5 text-2xs"
      aria-label="Trading settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSave(parsed);
        setEditing(false);
      }}
    >
      <label htmlFor={`${id}-cap`} className="text-muted-foreground">
        Cap per order $
      </label>
      <input
        id={`${id}-cap`}
        data-testid="size-cap-input"
        type="number"
        inputMode="numeric"
        min={MIN_ORDER_USD}
        max={hardMax}
        step={1}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        aria-describedby={`${id}-cap-range`}
        className="h-6 w-20 rounded-sm border bg-background px-1.5 font-mono text-xs text-foreground"
      />
      <Button
        type="submit"
        variant="outline"
        size="xs"
        data-testid="size-cap-save"
        disabled={!valid}
      >
        Save
      </Button>
      <button type="button" className={QUIET_LINK} onClick={() => setEditing(false)}>
        Cancel
      </button>
      <span id={`${id}-cap-range`} className="w-full font-mono text-faint">
        {formatSizeUsd(MIN_ORDER_USD)} to {formatSizeUsd(hardMax)}. Kept in this browser.
      </span>
    </form>
  );
}

/**
 * The review before the order: what the order sends, with the worst fill
 * price (the IOC limit price). The same builder as the hook makes the
 * numbers; the hook reads the mid once more right before it sends.
 */
function ReviewCard({
  network,
  asset,
  coin,
  side,
  sizeUsd,
  leverage,
  mid,
}: {
  network: Network;
  asset: PerpAsset;
  coin: string;
  side: PositionSide;
  sizeUsd: number;
  leverage: number;
  mid: number;
}) {
  let order: { size: string; price: string } | null = null;
  try {
    const built = buildIocOrder({
      assetIndex: asset.index,
      szDecimals: asset.szDecimals,
      side,
      sizeUsd,
      mid,
      slippage: TRADING_LIMITS[network].slippage,
    });
    order = { size: built.s, price: built.p };
  } catch {
    order = null;
  }
  const margin = estimateMargin(sizeUsd, leverage);
  const liquidation = estimateLiquidation({
    entryPx: mid,
    leverage,
    side,
    maxLeverage: asset.maxLeverage,
  });
  const slippagePct = `${TRADING_LIMITS[network].slippage * 100}%`;

  return (
    <div data-testid="review-card" className="flex flex-col gap-2">
      <dl className="divide-y rounded-md border border-brand/40">
        <SummaryRow label="Network">
          <span data-testid="review-network" className="font-sans font-medium text-brand">
            {networkLabel(network)}
            {network === "mainnet" ? " · real funds" : " · test funds"}
          </span>
        </SummaryRow>
        <SummaryRow label="Order">
          <span className={cn("font-sans", side === "long" ? "text-long" : "text-short")}>
            {side === "long" ? "Buy" : "Sell"} {displaySymbol(coin)} perp
          </span>
        </SummaryRow>
        <SummaryRow label="Size">
          <span data-testid="review-size">
            {order ? `${formatSize(Number(order.size))} ${displaySymbol(coin)}` : EMPTY_VALUE}
            <span className="ml-1.5 text-faint">{formatUsd(sizeUsd)}</span>
          </span>
        </SummaryRow>
        <SummaryRow label="Leverage">{leverage}x</SummaryRow>
        <SummaryRow label={`Worst fill price (${slippagePct} from mid)`}>
          <span data-testid="review-worst-price">
            {order ? formatPrice(Number(order.price)) : EMPTY_VALUE}
          </span>
        </SummaryRow>
        <SummaryRow label="Est. margin">
          {margin === null ? EMPTY_VALUE : formatUsd(margin)}
        </SummaryRow>
        <SummaryRow label="Est. liquidation price">
          {liquidation === null ? EMPTY_VALUE : formatPrice(liquidation.liquidationPx)}
        </SummaryRow>
      </dl>
      <p className="text-2xs text-muted-foreground">
        Immediate-or-cancel. Unfilled size is cancelled. Estimates ignore fees.
      </p>
    </div>
  );
}

/** Mainnet only: the one-time risk acknowledgement before the first approval. */
function RiskPanel({
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

function AgentBlock({
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

function StepText({ step, network }: { step: 1 | 2 | 3; network: Network }) {
  if (step === 1) {
    return (
      <p className="text-2xs text-muted-foreground">
        Connect a browser wallet. Slipstream never asks for your wallet key.
      </p>
    );
  }
  if (step === 2) {
    const ttl = network === "mainnet" ? "24 h" : "7 days";
    return (
      <p className="text-2xs text-muted-foreground">
        One signature approves a Slipstream agent: a {network} trading key that stays in this
        browser for {ttl}.
      </p>
    );
  }
  return (
    <p className="text-2xs text-muted-foreground">
      An IOC order at 1% through the {network} mid. Minimum $10. You review it before it is sent.
    </p>
  );
}

function ErrorNotice({ error }: { error: TradingError }) {
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
