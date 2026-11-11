import { z } from "zod";

/*
 * Zod schemas for every Hyperliquid response that the app reads.
 * The shapes come from the real responses in fixtures/.
 * Each raw schema matches the wire format (numbers arrive as strings).
 * A transform turns it into a domain object with real numbers, so
 * components only see parsed types.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** A decimal string such as "93174274.95". Parses to a finite number. */
export const numericString = z.string().transform((value, ctx) => {
  const parsed = value.trim() === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: "custom", message: `Not a finite number: "${value}"` });
    return z.NEVER;
  }
  return parsed;
});

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Not an address")
  .transform((value) => value.toLowerCase());

export const TIME_WINDOWS = ["day", "week", "month", "allTime"] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

function isTimeWindow(value: string): value is TimeWindow {
  return (TIME_WINDOWS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Leaderboard: GET the raw file of the network (HL.leaderboardUrl in lib/network.ts)
// ---------------------------------------------------------------------------

/** The top-level envelope. Rows are checked one at a time. */
export const rawLeaderboardEnvelopeSchema = z.object({
  leaderboardRows: z.array(z.unknown()),
});

const windowPerformanceSchema = z.object({
  pnl: z.number(),
  roi: z.number(),
  vlm: z.number(),
});
export type WindowPerformance = z.infer<typeof windowPerformanceSchema>;

/** The compact, parsed shape that /api/leaderboard sends to the browser. */
export const leaderboardEntrySchema = z.object({
  address: z.string(),
  displayName: z.string().nullable(),
  accountValue: z.number(),
  windows: z.object({
    day: windowPerformanceSchema,
    week: windowPerformanceSchema,
    month: windowPerformanceSchema,
    allTime: windowPerformanceSchema,
  }),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

const rawWindowPerformanceSchema = z.object({
  pnl: numericString,
  roi: numericString,
  vlm: numericString,
});

/** One row of the raw leaderboard file. */
export const rawLeaderboardRowSchema = z
  .object({
    ethAddress: addressSchema,
    accountValue: numericString,
    windowPerformances: z.array(z.tuple([z.string(), rawWindowPerformanceSchema])),
    displayName: z.string().nullable(),
  })
  .transform((row, ctx): LeaderboardEntry => {
    const found: Partial<Record<TimeWindow, WindowPerformance>> = {};
    for (const [name, performance] of row.windowPerformances) {
      if (isTimeWindow(name)) found[name] = performance;
    }
    const { day, week, month, allTime } = found;
    if (!day || !week || !month || !allTime) {
      ctx.addIssue({ code: "custom", message: "Missing a time window" });
      return z.NEVER;
    }
    return {
      address: row.ethAddress,
      displayName: row.displayName,
      accountValue: row.accountValue,
      windows: { day, week, month, allTime },
    };
  });

/** The body of GET /api/leaderboard. */
export const leaderboardResponseSchema = z.object({
  updatedAt: z.number(),
  stale: z.boolean().optional(),
  rows: z.array(leaderboardEntrySchema),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

// ---------------------------------------------------------------------------
// Info: {"type":"clearinghouseState","user":"0x..."}
// ---------------------------------------------------------------------------

const rawMarginSummarySchema = z.object({
  accountValue: numericString,
  totalNtlPos: numericString,
  totalRawUsd: numericString,
  totalMarginUsed: numericString,
});

const rawLeverageSchema = z.object({
  type: z.enum(["cross", "isolated"]),
  value: z.number(),
  // Only isolated positions carry rawUsd.
  rawUsd: numericString.optional(),
});

export type PositionSide = "long" | "short";

export interface Position {
  coin: string;
  /** Signed size in coin units. Negative means short. */
  size: number;
  side: PositionSide;
  leverage: number;
  leverageType: "cross" | "isolated";
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  /** Return on equity as a ratio (0.05 = 5 %). */
  roe: number;
  liquidationPx: number | null;
  marginUsed: number;
  maxLeverage: number;
}

export const rawPositionSchema = z
  .object({
    coin: z.string(),
    szi: numericString,
    leverage: rawLeverageSchema,
    entryPx: numericString,
    positionValue: numericString,
    unrealizedPnl: numericString,
    returnOnEquity: numericString,
    liquidationPx: numericString.nullable(),
    marginUsed: numericString,
    maxLeverage: z.number(),
  })
  .transform((p): Position => ({
    coin: p.coin,
    size: p.szi,
    side: p.szi < 0 ? "short" : "long",
    leverage: p.leverage.value,
    leverageType: p.leverage.type,
    entryPx: p.entryPx,
    positionValue: p.positionValue,
    unrealizedPnl: p.unrealizedPnl,
    roe: p.returnOnEquity,
    liquidationPx: p.liquidationPx,
    marginUsed: p.marginUsed,
    maxLeverage: p.maxLeverage,
  }));

export interface ClearinghouseState {
  accountValue: number;
  totalMarginUsed: number;
  totalNotional: number;
  withdrawable: number;
  positions: Position[];
  /** Server time in ms. */
  time: number;
}

export const clearinghouseStateSchema = z
  .object({
    marginSummary: rawMarginSummarySchema,
    withdrawable: numericString,
    assetPositions: z.array(z.object({ type: z.string(), position: rawPositionSchema })),
    time: z.number(),
  })
  .transform((s): ClearinghouseState => ({
    accountValue: s.marginSummary.accountValue,
    totalMarginUsed: s.marginSummary.totalMarginUsed,
    totalNotional: s.marginSummary.totalNtlPos,
    withdrawable: s.withdrawable,
    positions: s.assetPositions.map((entry) => entry.position),
    time: s.time,
  }));

// ---------------------------------------------------------------------------
// Info: {"type":"userFills","user":"0x..."} (also used by the WebSocket)
// ---------------------------------------------------------------------------

export interface Fill {
  coin: string;
  px: number;
  sz: number;
  side: "buy" | "sell";
  /** Fill time in ms. */
  time: number;
  /** Free text such as "Open Long" or "Close Short". */
  dir: string;
  closedPnl: number;
  oid: number;
  tid: number;
  fee: number;
  hash: string;
  startPosition: number;
  crossed: boolean;
}

export const fillSchema = z
  .object({
    coin: z.string(),
    px: numericString,
    sz: numericString,
    side: z.enum(["A", "B"]),
    time: z.number(),
    startPosition: numericString,
    dir: z.string(),
    closedPnl: numericString,
    hash: z.string(),
    oid: z.number(),
    crossed: z.boolean(),
    fee: numericString,
    tid: z.number(),
  })
  .transform((f): Fill => ({
    coin: f.coin,
    px: f.px,
    sz: f.sz,
    // "B" is a bid (buy), "A" is an ask (sell).
    side: f.side === "B" ? "buy" : "sell",
    time: f.time,
    dir: f.dir,
    closedPnl: f.closedPnl,
    oid: f.oid,
    tid: f.tid,
    fee: f.fee,
    hash: f.hash,
    startPosition: f.startPosition,
    crossed: f.crossed,
  }));

export const userFillsSchema = z.array(fillSchema);

// ---------------------------------------------------------------------------
// Info: {"type":"portfolio","user":"0x..."}
// ---------------------------------------------------------------------------

export interface TimePoint {
  /** Time in ms. */
  time: number;
  value: number;
}

export interface PortfolioWindow {
  accountValueHistory: TimePoint[];
  pnlHistory: TimePoint[];
  vlm: number;
}

export type Portfolio = Record<TimeWindow, PortfolioWindow>;

const rawHistorySchema = z
  .array(z.tuple([z.number(), numericString]))
  .transform((points): TimePoint[] => points.map(([time, value]) => ({ time, value })));

const rawPortfolioWindowSchema = z.object({
  accountValueHistory: rawHistorySchema,
  pnlHistory: rawHistorySchema,
  vlm: numericString,
});

/** The perp* entries pass through the tuple check and are then ignored. */
export const portfolioSchema = z
  .array(z.tuple([z.string(), rawPortfolioWindowSchema]))
  .transform((entries, ctx): Portfolio => {
    const found: Partial<Portfolio> = {};
    for (const [name, value] of entries) {
      if (isTimeWindow(name)) found[name] = value;
    }
    const { day, week, month, allTime } = found;
    if (!day || !week || !month || !allTime) {
      ctx.addIssue({ code: "custom", message: "Missing a portfolio window" });
      return z.NEVER;
    }
    return { day, week, month, allTime };
  });

// ---------------------------------------------------------------------------
// WebSocket: the socket of the network (HL.wsUrl in lib/network.ts)
// ---------------------------------------------------------------------------

/** Spot markets start with "@" and builder markets with "#". We keep perps only. */
export function isPerpCoin(coin: string): boolean {
  return !coin.startsWith("@") && !coin.startsWith("#");
}

export interface AllMidsMessage {
  channel: "allMids";
  /** Perp coin to mid price. Spot and builder keys are dropped. */
  mids: Record<string, number>;
}

/** Keep perp coins with a finite mid. One bad value is skipped, not the whole map. */
function parseMidsRecord(raw: Record<string, string>): Record<string, number> {
  const mids: Record<string, number> = {};
  for (const [coin, text] of Object.entries(raw)) {
    if (!isPerpCoin(coin)) continue;
    const value = Number(text);
    if (text.trim() !== "" && Number.isFinite(value)) mids[coin] = value;
  }
  return mids;
}

export const allMidsMessageSchema = z
  .object({
    channel: z.literal("allMids"),
    data: z.object({ mids: z.record(z.string(), z.string()) }),
  })
  .transform((message): AllMidsMessage => ({
    channel: "allMids",
    mids: parseMidsRecord(message.data.mids),
  }));

/** Info {"type":"allMids"} over REST: the same map as the socket, without the envelope. */
export const allMidsSchema = z.record(z.string(), z.string()).transform(parseMidsRecord);

export interface UserFillsMessage {
  channel: "userFills";
  /** True for the first message after a subscribe (history, not new fills). */
  isSnapshot: boolean;
  user: string;
  fills: Fill[];
}

export const userFillsMessageSchema = z
  .object({
    channel: z.literal("userFills"),
    data: z.object({
      isSnapshot: z.boolean().optional(),
      user: addressSchema,
      fills: z.array(fillSchema),
    }),
  })
  .transform((message): UserFillsMessage => ({
    channel: "userFills",
    isSnapshot: message.data.isSnapshot === true,
    user: message.data.user,
    fills: message.data.fills,
  }));

export const subscriptionResponseSchema = z.object({
  channel: z.literal("subscriptionResponse"),
  data: z.object({
    method: z.string(),
    subscription: z.record(z.string(), z.unknown()),
  }),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const pongSchema = z.object({ channel: z.literal("pong") });
export type Pong = z.infer<typeof pongSchema>;

/** A message on a channel that the app does not use. */
export interface UnknownChannelMessage {
  channel: "unknown";
  originalChannel: string;
}

export type WsMessage =
  AllMidsMessage | UserFillsMessage | SubscriptionResponse | Pong | UnknownChannelMessage;

const wsEnvelopeSchema = z.object({ channel: z.string() });

/**
 * Parse one decoded WebSocket message. Known channels must match their
 * schema. Unknown channels map to the fallback branch.
 * Returns null when the message is invalid.
 */
export function parseWsMessage(input: unknown): WsMessage | null {
  const envelope = wsEnvelopeSchema.safeParse(input);
  if (!envelope.success) return null;
  const parse = (schema: z.ZodType<WsMessage, unknown>): WsMessage | null => {
    const result = schema.safeParse(input);
    return result.success ? result.data : null;
  };
  switch (envelope.data.channel) {
    case "allMids":
      return parse(allMidsMessageSchema);
    case "userFills":
      return parse(userFillsMessageSchema);
    case "subscriptionResponse":
      return parse(subscriptionResponseSchema);
    case "pong":
      return parse(pongSchema);
    default:
      return { channel: "unknown", originalChannel: envelope.data.channel };
  }
}

// ---------------------------------------------------------------------------
// Info: {"type":"meta"} (used for the testnet universe)
// ---------------------------------------------------------------------------

export interface PerpAsset {
  /** The asset id in orders: the position in `universe`. */
  index: number;
  name: string;
  szDecimals: number;
  maxLeverage: number;
  /** The asset allows isolated margin only. */
  onlyIsolated: boolean;
  isDelisted: boolean;
}

/** Extra keys (marginTableId, marginMode, marginTables) are stripped. */
export const metaSchema = z
  .object({
    universe: z.array(
      z.object({
        name: z.string().min(1),
        szDecimals: z.number().int().min(0),
        maxLeverage: z.number().int().min(1),
        onlyIsolated: z.boolean().optional(),
        isDelisted: z.boolean().optional(),
      }),
    ),
  })
  .transform((meta): PerpAsset[] =>
    meta.universe.map((asset, index) => ({
      index,
      name: asset.name,
      szDecimals: asset.szDecimals,
      maxLeverage: asset.maxLeverage,
      onlyIsolated: asset.onlyIsolated === true,
      isDelisted: asset.isDelisted === true,
    })),
  );
