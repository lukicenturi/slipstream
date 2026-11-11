"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { PositionSide } from "@/lib/hyperliquid/schemas";

import { CopyTradeSheet } from "./CopyTradeSheet";

/** The values that pre-fill the sheet. Only the coin and the side are required. */
export interface CopyTradePrefill {
  coin: string;
  side: PositionSide;
  /** The mark price when the button was pressed. The sheet then follows the live mid. */
  markPx?: number;
  /** Max leverage of the coin. Without it the slider goes to 20x. */
  maxLeverage?: number;
  /** The trader's leverage, when known. */
  leverage?: number;
  sizeUsd?: number;
}

interface CopyTradeActions {
  openCopyTrade: (prefill: CopyTradePrefill) => void;
}

const CopyTradeContext = createContext<CopyTradeActions | null>(null);

interface SheetState {
  open: boolean;
  prefill: CopyTradePrefill | null;
  /** Changes on every open, so the form starts again from the new prefill. */
  session: number;
}

/**
 * Holds the one copy-trade sheet of the app. Mount it once.
 * The context value only holds the stable `openCopyTrade` function, so
 * memoised rows that read it do not re-render when the sheet opens.
 * In the read-only build the sheet makes no network call. In a testnet
 * build it reads testnet data and can place a testnet order.
 */
export function CopyTradeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SheetState>({ open: false, prefill: null, session: 0 });
  // The element that opened the sheet. Focus goes back to it on close.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openCopyTrade = useCallback((prefill: CopyTradePrefill) => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    setState((current) => ({ open: true, prefill, session: current.session + 1 }));
  }, []);

  const onOpenChange = useCallback((open: boolean) => {
    // Keep the prefill while the sheet animates out.
    setState((current) => ({ ...current, open }));
  }, []);

  // The sheet has no Radix trigger, so Radix cannot restore focus on its own.
  const onCloseAutoFocus = useCallback((event: Event) => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // The row may be gone (a feed item can drop off the list while the sheet is open).
    if (target?.isConnected) {
      event.preventDefault();
      target.focus();
    }
  }, []);

  const actions = useMemo(() => ({ openCopyTrade }), [openCopyTrade]);

  return (
    <CopyTradeContext value={actions}>
      {children}
      <CopyTradeSheet
        open={state.open}
        onOpenChange={onOpenChange}
        prefill={state.prefill}
        session={state.session}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </CopyTradeContext>
  );
}

/** The function that opens the copy-trade sheet. Use it inside `CopyTradeProvider`. */
export function useCopyTrade(): CopyTradeActions["openCopyTrade"] {
  const actions = useContext(CopyTradeContext);
  if (!actions) throw new Error("useCopyTrade must be used inside CopyTradeProvider");
  return actions.openCopyTrade;
}
