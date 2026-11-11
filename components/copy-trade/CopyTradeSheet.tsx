"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { LazyTestnetCopyTradeForm } from "@/components/trading/lazy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMid } from "@/hooks/useMid";
import {
  DEFAULT_SIZE_USD,
  clampSizeUsd,
  initialLeverage,
  resolveMaxLeverage,
} from "@/lib/calc/copyTrade";
import type { PositionSide } from "@/lib/hyperliquid/schemas";
import { TRADING_ENABLED } from "@/lib/trading/config";

import {
  AssetRow,
  CopySummary,
  CopyTradeHeader,
  LeverageField,
  SizeField,
} from "./CopyTradeFields";
import type { CopyTradePrefill } from "./CopyTradeProvider";

export const DEMO_CONFIRM_LABEL = "Demo, no order is placed";
export const DEMO_TOAST = "Demo only. No order was sent.";

/**
 * The copy-trade sheet. A bottom sheet on every screen size: full width on
 * mobile, 480 px wide and centred from `sm` up. The read-only build shows
 * the demo form: estimates only, and confirm sends nothing. A build with
 * NEXT_PUBLIC_TRADING_MODE=testnet shows the testnet form instead.
 */
export function CopyTradeSheet({
  open,
  onOpenChange,
  prefill,
  session,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: CopyTradePrefill | null;
  session: number;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-testid="copy-trade-sheet"
        data-mode={TRADING_ENABLED ? "testnet" : "demo"}
        onCloseAutoFocus={onCloseAutoFocus}
        className="mx-auto max-h-[92dvh] w-full max-w-[480px] gap-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
      >
        {prefill ? (
          TRADING_ENABLED ? (
            <LazyTestnetCopyTradeForm key={session} prefill={prefill} open={open} />
          ) : (
            <DemoCopyTradeForm key={session} prefill={prefill} onDone={close} />
          )
        ) : (
          <>
            <SheetTitle className="sr-only">Copy trade</SheetTitle>
            <SheetDescription className="sr-only">No trade selected.</SheetDescription>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DemoCopyTradeForm({ prefill, onDone }: { prefill: CopyTradePrefill; onDone: () => void }) {
  const { coin } = prefill;
  const id = useId();
  const maxLeverage = resolveMaxLeverage(prefill.maxLeverage);

  const [side, setSide] = useState<PositionSide>(prefill.side);
  const [sizeUsd, setSizeUsd] = useState(() => clampSizeUsd(prefill.sizeUsd ?? DEFAULT_SIZE_USD));
  const [leverage, setLeverage] = useState(() => initialLeverage(prefill.leverage, maxLeverage));

  const liveMid = useMid(coin);
  const mark = liveMid ?? prefill.markPx;

  function onConfirm() {
    // Demo only: no request, no signature, no order.
    toast(DEMO_TOAST);
    onDone();
  }

  return (
    <>
      <CopyTradeHeader badge={<Badge>Demo</Badge>} />
      <SheetDescription className="sr-only">
        Set a side, a size and a leverage to see estimates. This is a demo. No order is placed.
      </SheetDescription>

      <div className="flex flex-col gap-3 p-4">
        <AssetRow coin={coin} sideName={`${id}-side`} side={side} onSideChange={setSide} />
        <SizeField id={id} value={sizeUsd} onChange={setSizeUsd} />
        <LeverageField value={leverage} max={maxLeverage} onChange={setLeverage} />
        <CopySummary
          coin={coin}
          mark={mark}
          sizeUsd={sizeUsd}
          leverage={leverage}
          side={side}
          maxLeverage={prefill.maxLeverage}
        />
        <p className="text-2xs text-muted-foreground">
          Estimate for an isolated position opened at the mark price. It ignores cross margin,
          funding and fees. Slipstream sends no order.
        </p>
      </div>

      <SheetFooter className="border-t px-4 pt-3 pb-4">
        <Button
          type="button"
          size="lg"
          className="h-10 w-full text-sm font-semibold"
          onClick={onConfirm}
          data-testid="copy-confirm"
        >
          {DEMO_CONFIRM_LABEL}
        </Button>
      </SheetFooter>
    </>
  );
}
