"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { SHEET_CONTENT_CLASS } from "@/components/copy-trade/CopyTradeFields";
import { SkeletonRows } from "@/components/shared/States";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { Position } from "@/lib/hyperliquid/schemas";
import { NETWORK, TRADING_ENABLED } from "@/lib/trading/config";

/*
 * The close-position sheet of a trading build. The form signs orders, so
 * it loads in its own chunk (a dynamic import): the wallet guard follows
 * only static imports, and a read-only build never renders the form.
 */
const ClosePositionForm = dynamic(() => import("@/components/trading/ClosePositionForm"), {
  ssr: false,
  loading: () => <SkeletonRows rows={6} label="Loading the close form" />,
});

/** The position to close and the address that holds it. */
export interface CloseTarget {
  /** The lower-case address that holds the position. */
  owner: string;
  position: Position;
}

interface CloseActions {
  openClosePosition: (target: CloseTarget) => void;
}

const ClosePositionContext = createContext<CloseActions | null>(null);

interface SheetState {
  open: boolean;
  target: CloseTarget | null;
  /** Changes on every open, so the form starts again. */
  session: number;
}

/**
 * Holds the one close-position sheet of the app. Mount it once. The
 * context value only holds the stable open function, so memoised position
 * rows do not re-render when the sheet opens. In a read-only build it
 * renders no sheet.
 */
export function ClosePositionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SheetState>({ open: false, target: null, session: 0 });
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openClosePosition = useCallback((target: CloseTarget) => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    setState((current) => ({ open: true, target, session: current.session + 1 }));
  }, []);

  const onOpenChange = useCallback((open: boolean) => {
    setState((current) => ({ ...current, open }));
  }, []);

  // The sheet has no Radix trigger, so focus goes back to the Close button by hand.
  const onCloseAutoFocus = useCallback((event: Event) => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // After a full close the row is gone; then Radix keeps its default.
    if (target?.isConnected) {
      event.preventDefault();
      target.focus();
    }
  }, []);

  const actions = useMemo(() => ({ openClosePosition }), [openClosePosition]);

  return (
    <ClosePositionContext value={actions}>
      {children}
      {TRADING_ENABLED ? (
        <Sheet open={state.open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            data-testid="close-position-sheet"
            data-mode={NETWORK}
            showCloseButton={false}
            onCloseAutoFocus={onCloseAutoFocus}
            className={SHEET_CONTENT_CLASS}
          >
            {state.target ? (
              <ClosePositionForm
                key={state.session}
                target={state.target}
                open={state.open}
                onDone={() => onOpenChange(false)}
              />
            ) : (
              <>
                <SheetTitle className="sr-only">Close position</SheetTitle>
                <SheetDescription className="sr-only">No position selected.</SheetDescription>
              </>
            )}
          </SheetContent>
        </Sheet>
      ) : null}
    </ClosePositionContext>
  );
}

/** The function that opens the close sheet. Use it inside `ClosePositionProvider`. */
export function useClosePositionSheet(): CloseActions["openClosePosition"] {
  const actions = useContext(ClosePositionContext);
  if (!actions) throw new Error("useClosePositionSheet must be used inside ClosePositionProvider");
  return actions.openClosePosition;
}
