"use client";

import { memo } from "react";

import { CopyTradeButton } from "@/components/copy-trade/CopyTradeButton";
import { AssetIcon } from "@/components/shared/AssetIcon";
import { DexBadge } from "@/components/shared/DexBadge";
import { Price } from "@/components/shared/Price";
import { Side } from "@/components/shared/Side";
import { signTone } from "@/components/shared/tone";
import { Button } from "@/components/ui/button";
import { useMid } from "@/hooks/useMid";
import { displaySymbol } from "@/lib/assets";
import { returnOnEquity, unrealizedPnl } from "@/lib/calc/positions";
import { EMPTY_VALUE, formatPercent, formatPrice, formatSize, formatUsd } from "@/lib/format";
import type { Position } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

const CELL = "px-3 text-right font-mono text-xs whitespace-nowrap";

/**
 * One open position. The mark price is the live mid of the coin, read in
 * this row, so a tick re-renders only the rows of that coin.
 * Before the first mid, the row shows the values from the API.
 */
export const PositionRow = memo(function PositionRow({
  position,
  dex = null,
  showCopy = true,
}: {
  position: Position;
  /** The builder exchange of the position, or null for the main exchange. */
  dex?: string | null;
  /** False on the account page: it shows your own positions and only reads. */
  showCopy?: boolean;
}) {
  const mid = useMid(position.coin);
  const pnl = unrealizedPnl(position, mid);
  const roe = returnOnEquity(position, pnl, mid);
  const absSize = Math.abs(position.size);
  // The mark at the time of the API response, until the first mid arrives.
  const apiMark = absSize > 0 ? position.positionValue / absSize : undefined;
  const mark = mid ?? apiMark;

  return (
    <tr
      data-testid="position-row"
      data-coin={position.coin}
      className="group h-9 border-b transition-colors hover:bg-surface-hover"
    >
      <th
        scope="row"
        className="sticky left-0 z-[1] bg-background px-3 text-left text-xs font-medium whitespace-nowrap text-foreground transition-colors group-hover:bg-surface-hover max-md:border-r"
      >
        <span className="inline-flex items-center gap-1.5" title={position.coin}>
          <AssetIcon coin={position.coin} />
          {displaySymbol(position.coin)}
          {dex ? <DexBadge dex={dex} /> : null}
        </span>
      </th>
      <td className="px-3">
        <Side
          label={position.side === "long" ? "Long" : "Short"}
          tone={position.side === "long" ? "long" : "short"}
        />
      </td>
      <td className={cn(CELL, "text-foreground")}>{formatSize(absSize)}</td>
      <td className={cn(CELL, "font-sans text-muted-foreground")}>
        <span className="font-mono text-foreground">{position.leverage}x</span>{" "}
        {position.leverageType}
      </td>
      <td className={cn(CELL, "text-foreground")}>{formatPrice(position.entryPx)}</td>
      <td className={cn(CELL, "text-foreground")} data-testid="position-mark">
        <Price value={mark} className="-mx-1" />
      </td>
      <td className={cn(CELL, signTone(pnl))} data-testid="position-pnl">
        {formatUsd(pnl, { signed: true })}{" "}
        <span className="text-2xs">({formatPercent(roe, { signed: true })})</span>
      </td>
      <td className={cn(CELL, "text-foreground")}>
        {position.liquidationPx === null ? (
          <span className="text-faint">{EMPTY_VALUE}</span>
        ) : (
          formatPrice(position.liquidationPx)
        )}
      </td>
      {showCopy ? (
        <td className="px-3 text-right">
          {dex ? (
            // The sheet places orders on the main exchange only. A disabled button
            // gets no pointer events, so the wrapper carries the tooltip.
            <span title="Builder exchange, not supported" className="inline-flex">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled
                aria-label={`Copy ${displaySymbol(position.coin)}: builder exchange, not supported`}
                data-testid="copy-trade-button-disabled"
              >
                Copy
              </Button>
            </span>
          ) : (
            <CopyTradeButton
              coin={position.coin}
              side={position.side}
              fallbackMarkPx={apiMark}
              maxLeverage={position.maxLeverage}
              leverage={position.leverage}
            />
          )}
        </td>
      ) : null}
    </tr>
  );
});
