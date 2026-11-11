"use client";

import { Button } from "@/components/ui/button";
import { midsStore } from "@/lib/hyperliquid/mids";
import type { PositionSide } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

import { useCopyTrade, type CopyTradePrefill } from "./CopyTradeProvider";

/**
 * Opens the demo copy-trade sheet for one coin and side. It reads the mid
 * once, on press, so price ticks do not re-render the row.
 */
export function CopyTradeButton({
  coin,
  side,
  fallbackMarkPx,
  maxLeverage,
  leverage,
  className,
}: {
  coin: string;
  side: PositionSide;
  /** The mark to use when no live mid exists yet. */
  fallbackMarkPx?: number;
  maxLeverage?: number;
  leverage?: number;
  className?: string;
}) {
  const openCopyTrade = useCopyTrade();
  const sideWord = side === "long" ? "long" : "short";

  function onClick() {
    const prefill: CopyTradePrefill = {
      coin,
      side,
      markPx: midsStore.get(coin) ?? fallbackMarkPx,
      maxLeverage,
      leverage,
    };
    openCopyTrade(prefill);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={onClick}
      aria-label={`Copy ${sideWord} ${coin} (demo)`}
      aria-haspopup="dialog"
      data-testid="copy-trade-button"
      className={cn("hover:border-brand/60 hover:text-brand", className)}
    >
      Copy
    </Button>
  );
}
