import type { Fill, PositionSide } from "@/lib/hyperliquid/schemas";

/*
 * Turn the free-text `dir` of a fill into words for the feed.
 * Known values come from the real fills in fixtures/ and the API docs.
 */

export interface FillAction {
  /** Words such as "opened long" or "was liquidated". */
  phrase: string;
  /**
   * The side of the position that the order is about, for the side badge.
   * Null for spot trades and unknown values, which show buy/sell instead.
   */
  positionSide: PositionSide | null;
}

const KNOWN: Record<string, FillAction> = {
  "Open Long": { phrase: "opened long", positionSide: "long" },
  "Open Short": { phrase: "opened short", positionSide: "short" },
  "Close Long": { phrase: "closed long", positionSide: "long" },
  "Close Short": { phrase: "closed short", positionSide: "short" },
  "Long > Short": { phrase: "flipped to short", positionSide: "short" },
  "Short > Long": { phrase: "flipped to long", positionSide: "long" },
  Buy: { phrase: "bought", positionSide: null },
  Sell: { phrase: "sold", positionSide: null },
};

function sideFromText(dir: string): PositionSide | null {
  if (/\blong\b/i.test(dir)) return "long";
  if (/\bshort\b/i.test(dir)) return "short";
  return null;
}

export function describeFillAction(dir: string): FillAction {
  const known = KNOWN[dir];
  if (known) return known;
  if (dir.startsWith("Liquidated")) {
    return { phrase: "was liquidated", positionSide: sideFromText(dir) };
  }
  return { phrase: dir.toLowerCase(), positionSide: sideFromText(dir) };
}

/** The badge text and tone for one feed row. */
export function sideLabel(
  action: FillAction,
  side: Fill["side"],
): { label: string; tone: "long" | "short" } {
  if (action.positionSide === "long") return { label: "Long", tone: "long" };
  if (action.positionSide === "short") return { label: "Short", tone: "short" };
  return side === "buy" ? { label: "Buy", tone: "long" } : { label: "Sell", tone: "short" };
}
