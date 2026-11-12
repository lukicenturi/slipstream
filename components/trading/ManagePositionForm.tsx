"use client";

import { useId, useState, type ReactNode } from "react";

import type { ManageTab, ManageTarget } from "@/components/manage-position/ManagePositionProvider";
import {
  SHEET_BODY_CLASS,
  SHEET_FOOTER_CLASS,
  SheetBar,
} from "@/components/copy-trade/CopyTradeFields";
import { SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { forgetAgent } from "@/hooks/useAgent";
import { useMid } from "@/hooks/useMid";
import { useNow } from "@/hooks/useNow";
import { useOpenOrders } from "@/hooks/useOpenOrders";
import { useRiskAck } from "@/hooks/useRiskAck";
import { useTradingMeta } from "@/hooks/useTradingMeta";
import { useApproveAgent } from "@/hooks/useTradingActions";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useTrailingConfigs } from "@/hooks/useTrailingStops";
import type { Position } from "@/lib/hyperliquid/schemas";
import { NETWORK, networkLabel } from "@/lib/trading/config";
import { findAsset } from "@/lib/trading/order";
import { isAcknowledged } from "@/lib/trading/riskAck";
import { positionTpsl } from "@/lib/trading/tpsl";
import { trailingLabelOids } from "@/lib/trading/trailing";

import { ConnectWalletPopover } from "./ConnectWallet";
import { CloseTab } from "./manage/CloseTab";
import { PositionSummary, type ManageContext } from "./manage/shared";
import { TpslTab } from "./manage/TpslTab";
import { TrailingTab } from "./manage/TrailingTab";
import { NetworkBadge } from "./NetworkBadge";
import { AgentBlock, ErrorNotice, PrimaryButton, RiskPanel, Spinner } from "./TradingParts";
import { TradingSteps } from "./TradingSteps";

const TABS: readonly { value: ManageTab; label: string }[] = [
  { value: "close", label: "Close" },
  { value: "tpsl", label: "TP / SL" },
  { value: "trailing", label: "Trailing" },
];

const STEP3_TEXT: Record<ManageTab, string> = {
  close: "A reduce-only IOC order at 1% through the mid. You review it before it is sent.",
  tpsl: "Reduce-only trigger orders for the whole position. You review them before they are sent.",
  trailing:
    "A reduce-only stop that this tab moves in your favour. You review it before it is sent.",
};

/**
 * Manage one of your positions on the build's network: Close, TP / SL and
 * Trailing, in one sheet. It reads the position from the live account and
 * the open orders every 10 s. The wallet, risk and agent steps are the same
 * as the copy-trade sheet; each tab has its own review and its own confirm
 * button. The per-order cap does not apply: every order here is reduce-only.
 */
export default function ManagePositionForm({
  target,
  open,
  onDone,
}: {
  target: ManageTarget;
  open: boolean;
  onDone: () => void;
}) {
  const coin = target.position.coin;
  const id = useId();
  const now = useNow();
  const session = useTradingSession({ live: open });
  const meta = useTradingMeta(open);
  const mid = useMid(coin);
  const approve = useApproveAgent(session.address);
  const riskAck = useRiskAck();
  const isOwner = session.address === target.owner;
  const openOrders = useOpenOrders(target.owner, { enabled: open && isOwner });
  const trailing = useTrailingConfigs(target.owner);

  const [tab, setTab] = useState<ManageTab>(target.tab ?? "close");
  const [riskChecked, setRiskChecked] = useState(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);

  // The live position: after a partial close the size shrinks; after a full close it is gone.
  const livePosition: Position | undefined = session.account.data
    ? session.account.data.positions.find((entry) => entry.coin === coin)
    : target.position;
  const asset = meta.data ? findAsset(meta.data, coin) : null;

  const step = session.status === "disconnected" ? 1 : session.status === "connected" ? 2 : 3;
  const needsRiskAck = NETWORK === "mainnet" && step === 2 && !isAcknowledged(riskAck.value, now);

  let baseBlock: string | null = null;
  if (!isOwner && session.address) baseBlock = "This position belongs to another address.";
  else if (!livePosition) baseBlock = "This position is closed.";
  else if (meta.isPending) baseBlock = `Loading ${NETWORK} markets.`;
  else if (meta.isError) baseBlock = `${networkLabel(NETWORK)} markets did not load.`;
  else if (!asset) baseBlock = `Not listed on ${NETWORK}.`;
  else if (mid === undefined) baseBlock = `Waiting for the ${NETWORK} price.`;

  function onForgetAgent() {
    if (!session.address) return;
    forgetAgent(session.address);
    approve.reset();
  }

  let sharedPrimary: ReactNode | null = null;
  if (step === 1) {
    sharedPrimary = (
      <ConnectWalletPopover side="top" align="center">
        <PrimaryButton disabled={session.isConnecting}>
          {session.isConnecting ? <Spinner /> : null}
          Connect wallet
        </PrimaryButton>
      </ConnectWalletPopover>
    );
  } else if (step === 2 && needsRiskAck) {
    sharedPrimary = (
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
    sharedPrimary = (
      <PrimaryButton onClick={() => approve.mutate()} disabled={approve.isPending}>
        {approve.isPending ? <Spinner /> : null}
        {approve.isPending ? "Waiting for signature…" : "Approve agent"}
      </PrimaryButton>
    );
  }

  const base: Omit<ManageContext, "active"> = {
    id,
    coin,
    owner: session.address,
    agent: session.agent,
    step,
    position: livePosition,
    asset,
    mid,
    baseBlock,
    sharedPrimary,
    // The live tracked trailing stop is the current stop loss, not a leftover of its last move.
    tpsl: positionTpsl(openOrders.data, coin, trailingLabelOids(trailing, openOrders.data ?? [])),
    orders: openOrders.data ?? [],
    ordersReady: openOrders.data !== undefined,
    footer,
    onDone,
  };

  return (
    <>
      <SheetBar title="Manage position" badge={<NetworkBadge network={NETWORK} />} />
      <SheetDescription className="sr-only">
        Close this position, set its take profit and stop loss, or start a trailing stop, with
        reduce-only orders on Hyperliquid {NETWORK}. You review every order before it is sent.
      </SheetDescription>

      <div className={SHEET_BODY_CLASS}>
        <PositionSummary
          position={livePosition ?? target.position}
          mid={mid}
          closed={!livePosition}
        />

        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value === "close" || value === "tpsl" || value === "trailing") setTab(value);
          }}
          className="gap-3"
        >
          <TabsList variant="line" aria-label="Manage" className="w-full gap-0">
            {TABS.map((entry) => (
              <TabsTrigger
                key={entry.value}
                value={entry.value}
                data-testid={`manage-tab-${entry.value}`}
                className="flex-1"
              >
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((entry) => (
            <TabsContent
              key={entry.value}
              value={entry.value}
              forceMount
              data-testid={`manage-panel-${entry.value}`}
              className="data-[state=inactive]:hidden"
            >
              {entry.value === "close" ? (
                <CloseTab ctx={{ ...base, active: tab === "close" }} />
              ) : entry.value === "tpsl" ? (
                <TpslTab ctx={{ ...base, active: tab === "tpsl" }} />
              ) : (
                <TrailingTab ctx={{ ...base, active: tab === "trailing" }} />
              )}
            </TabsContent>
          ))}
        </Tabs>

        <section
          aria-label={`${networkLabel(NETWORK)} trading`}
          className="flex flex-col gap-2 rounded-md border px-3 pt-1 pb-2.5"
        >
          <TradingSteps current={step} />
          {needsRiskAck ? (
            <RiskPanel id={id} checked={riskChecked} onCheckedChange={setRiskChecked} />
          ) : (
            <p className="text-2xs text-muted-foreground">
              {step === 1
                ? "Connect the wallet that holds this position."
                : step === 2
                  ? "One signature approves a Slipstream agent key that stays in this browser."
                  : STEP3_TEXT[tab]}
            </p>
          )}
          {approve.error ? <ErrorNotice error={approve.error} /> : null}
        </section>
      </div>

      <SheetFooter className={SHEET_FOOTER_CLASS}>
        <div ref={setFooter} data-testid="manage-footer" className="flex flex-col gap-2" />
        {session.agent ? (
          <AgentBlock agent={session.agent} now={now} onForget={onForgetAgent} />
        ) : null}
      </SheetFooter>
    </>
  );
}
