import { describe, expect, it } from "vitest";

import { isAcknowledged, parseRiskAck, RISK_ACK_KEY, RISK_ACK_MAX_AGE_MS } from "./riskAck";

const NOW = 1_794_391_401_196;
const DAY = 24 * 60 * 60 * 1000;

describe("parseRiskAck", () => {
  it("reads a stored confirmation", () => {
    expect(RISK_ACK_KEY).toBe("slipstream.mainnetRiskAck");
    expect(parseRiskAck(JSON.stringify({ at: NOW }))).toEqual({ at: NOW });
  });

  it("gives null for a missing, broken or wrong value", () => {
    expect(parseRiskAck(null)).toBeNull();
    expect(parseRiskAck("{bad")).toBeNull();
    expect(parseRiskAck('{"at":"yesterday"}')).toBeNull();
    expect(parseRiskAck('{"at":-1}')).toBeNull();
    expect(parseRiskAck("true")).toBeNull();
  });
});

describe("isAcknowledged", () => {
  it("is true for 30 days after the confirmation", () => {
    expect(RISK_ACK_MAX_AGE_MS).toBe(30 * DAY);
    expect(isAcknowledged({ at: NOW }, NOW)).toBe(true);
    expect(isAcknowledged({ at: NOW }, NOW + 30 * DAY - 1)).toBe(true);
    expect(isAcknowledged({ at: NOW }, NOW + 30 * DAY)).toBe(false);
  });

  it("is false without a confirmation and for one far in the future", () => {
    expect(isAcknowledged(null, NOW)).toBe(false);
    expect(isAcknowledged({ at: NOW + 60_001 }, NOW)).toBe(false);
    expect(isAcknowledged({ at: NOW + DAY }, NOW)).toBe(false);
  });

  it("accepts a confirmation a few seconds ahead of the 10 s shared clock", () => {
    expect(isAcknowledged({ at: NOW + 9_000 }, NOW)).toBe(true);
    expect(isAcknowledged({ at: NOW + 60_000 }, NOW)).toBe(true);
  });

  it("takes another maximum age", () => {
    expect(isAcknowledged({ at: NOW }, NOW + DAY, DAY)).toBe(false);
  });
});
