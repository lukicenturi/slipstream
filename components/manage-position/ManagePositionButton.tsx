"use client";

import { Button } from "@/components/ui/button";
import { displaySymbol } from "@/lib/assets";
import type { Position } from "@/lib/hyperliquid/schemas";
import { NETWORK } from "@/lib/trading/config";

import { useManagePosition } from "./ManagePositionProvider";

/** Opens the manage sheet (Close, TP / SL, Trailing) for one of your own positions. */
export function ManagePositionButton({ owner, position }: { owner: string; position: Position }) {
  const openManagePosition = useManagePosition();
  const sideWord = position.side === "long" ? "long" : "short";
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={() => openManagePosition({ owner, position })}
      aria-label={`Manage ${sideWord} ${displaySymbol(position.coin)} on ${NETWORK}`}
      aria-haspopup="dialog"
      data-testid="manage-position-button"
      className="hover:border-brand/60 hover:text-brand"
    >
      Manage
    </Button>
  );
}
