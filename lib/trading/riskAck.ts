import { z } from "zod";

/*
 * The one-time risk acknowledgement of the mainnet build. Before the first
 * agent approval, the user confirms that orders use real funds, that the
 * agent key lives in this browser, and that Slipstream is unaudited. The
 * confirmation is kept for 30 days, then the panel shows again.
 */

export const RISK_ACK_KEY = "slipstream.mainnetRiskAck";
export const RISK_ACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface RiskAck {
  /** The time of the confirmation, in ms. */
  at: number;
}

const riskAckSchema = z.object({ at: z.number().int().positive() });

/** Parse a stored value. Bad JSON or a wrong shape gives null. */
export function parseRiskAck(raw: string | null): RiskAck | null {
  if (raw === null) return null;
  try {
    const parsed = riskAckSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * How far in the future a confirmation may be. The sheet reads the time from
 * a shared clock that ticks every 10 s, so a confirmation made just now can
 * be a few seconds ahead of it. A value further ahead is not trusted.
 */
export const RISK_ACK_FUTURE_SKEW_MS = 60_000;

/** True when the confirmation exists, is not far in the future, and is younger than maxAgeMs. */
export function isAcknowledged(
  value: RiskAck | null,
  now: number,
  maxAgeMs: number = RISK_ACK_MAX_AGE_MS,
): boolean {
  if (!value) return false;
  const age = now - value.at;
  return age >= -RISK_ACK_FUTURE_SKEW_MS && age < maxAgeMs;
}
