"use client";

import { Button } from "@/components/ui/button";
import { displaySymbol } from "@/lib/assets";
import type { Position } from "@/lib/hyperliquid/schemas";
import { NETWORK } from "@/lib/trading/config";

import { useClosePositionSheet } from "./ClosePositionProvider";

/** Opens the close sheet for one of your own positions (trading builds only). */
export function ClosePositionButton({ owner, position }: { owner: string; position: Position }) {
  const openClosePosition = useClosePositionSheet();
  const sideWord = position.side === "long" ? "long" : "short";
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={() => openClosePosition({ owner, position })}
      aria-label={`Close ${sideWord} ${displaySymbol(position.coin)} on ${NETWORK}`}
      aria-haspopup="dialog"
      data-testid="close-position-button"
      className="hover:border-short/60 hover:text-short"
    >
      Close
    </Button>
  );
}
