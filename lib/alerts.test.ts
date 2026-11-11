import { describe, expect, it } from "vitest";

import {
  DEFAULT_ALERT_SETTINGS,
  isAlertEnabled,
  parseAlertSettings,
  setAddressAlert,
  setGlobal,
  shouldNotify,
} from "./alerts";

const A = "0xf5d81a135f756ca16544e53c20fc20643ec3ad53";
const B = "0x0000000000000000000000000000000000000001";

const liveItem = { live: true, user: A, dir: "Open Long", notional: 5_000 };

describe("parseAlertSettings", () => {
  it("returns the defaults for a missing value, bad JSON or another version", () => {
    expect(parseAlertSettings(null)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(parseAlertSettings("{nope")).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(parseAlertSettings(JSON.stringify({ version: 2, global: {}, perAddress: {} }))).toEqual(
      DEFAULT_ALERT_SETTINGS,
    );
    expect(parseAlertSettings("[]")).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it("has browser off, toasts on and no minimum by default", () => {
    expect(DEFAULT_ALERT_SETTINGS.global).toEqual({
      browser: false,
      minNotionalUsd: 0,
      toasts: true,
    });
  });

  it("keeps valid fields and replaces bad ones with defaults", () => {
    const raw = JSON.stringify({
      version: 1,
      global: { browser: true, minNotionalUsd: 5_000, toasts: "yes" },
      perAddress: {
        [A.toUpperCase().replace("0X", "0x")]: { enabled: false },
        "0x12": { enabled: false },
        [B]: { enabled: "no" },
      },
    });
    expect(parseAlertSettings(raw)).toEqual({
      version: 1,
      global: { browser: true, minNotionalUsd: 0, toasts: true },
      perAddress: { [A]: { enabled: false } },
    });
  });

  it("reads every allowed minimum size", () => {
    for (const minNotionalUsd of [0, 1_000, 10_000, 100_000]) {
      const raw = JSON.stringify({ version: 1, global: { minNotionalUsd }, perAddress: {} });
      expect(parseAlertSettings(raw).global.minNotionalUsd).toBe(minNotionalUsd);
    }
  });

  it("round-trips its own output", () => {
    const settings = setGlobal(setAddressAlert(DEFAULT_ALERT_SETTINGS, A, false), {
      browser: true,
      minNotionalUsd: 10_000,
    });
    expect(parseAlertSettings(JSON.stringify(settings))).toEqual(settings);
  });
});

describe("address alerts", () => {
  it("enables every address that has no entry", () => {
    expect(isAlertEnabled(DEFAULT_ALERT_SETTINGS, A)).toBe(true);
  });

  it("turns one address off and on, case-insensitive, without changing the input", () => {
    const off = setAddressAlert(DEFAULT_ALERT_SETTINGS, A.toUpperCase().replace("0X", "0x"), false);
    expect(isAlertEnabled(off, A)).toBe(false);
    expect(isAlertEnabled(off, B)).toBe(true);
    expect(isAlertEnabled(setAddressAlert(off, A, true), A)).toBe(true);
    expect(DEFAULT_ALERT_SETTINGS.perAddress).toEqual({});
  });

  it("patches global settings", () => {
    const next = setGlobal(DEFAULT_ALERT_SETTINGS, { toasts: false });
    expect(next.global).toEqual({ browser: false, minNotionalUsd: 0, toasts: false });
  });
});

describe("shouldNotify", () => {
  const settings = DEFAULT_ALERT_SETTINGS;

  it("notifies for a live item of a watched trader", () => {
    expect(shouldNotify({ item: liveItem, settings, watched: [A] })).toBe(true);
  });

  it("never notifies for a snapshot item", () => {
    expect(shouldNotify({ item: { ...liveItem, live: false }, settings, watched: [A] })).toBe(
      false,
    );
  });

  it("skips a trader who is not watched", () => {
    expect(shouldNotify({ item: liveItem, settings, watched: [B] })).toBe(false);
  });

  it("matches the user case-insensitively", () => {
    const item = { ...liveItem, user: A.toUpperCase().replace("0X", "0x") };
    expect(shouldNotify({ item, settings, watched: [A] })).toBe(true);
  });

  it("skips a trader whose alerts are off", () => {
    const off = setAddressAlert(settings, A, false);
    expect(shouldNotify({ item: liveItem, settings: off, watched: [A] })).toBe(false);
  });

  it("skips fills that the exchange made", () => {
    const item = { ...liveItem, dir: "Spot Dust Conversion" };
    expect(shouldNotify({ item, settings, watched: [A] })).toBe(false);
  });

  it("applies the minimum size, inclusive", () => {
    const min = setGlobal(settings, { minNotionalUsd: 10_000 });
    expect(shouldNotify({ item: liveItem, settings: min, watched: [A] })).toBe(false);
    expect(
      shouldNotify({ item: { ...liveItem, notional: 10_000 }, settings: min, watched: [A] }),
    ).toBe(true);
  });
});
