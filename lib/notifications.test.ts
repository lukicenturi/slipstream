import { describe, expect, it } from "vitest";

import { aggregateFills, toFeedItem } from "@/lib/calc/aggregateFills";
import { makeFill } from "@/lib/calc/testFills";

import {
  addNotices,
  burstText,
  clearNotices,
  collapseBurst,
  INITIAL_BURST_STATE,
  markAllRead,
  markRead,
  MAX_NOTICES,
  noticeFromFeedItem,
  noticeText,
  parseNotices,
  shouldShowBrowserNotice,
  unreadBadge,
  unreadCount,
  type Notice,
} from "./notifications";

const A = "0xf5d81a135f756ca16544e53c20fc20643ec3ad53";

function notice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: `${A}:1:1`,
    address: A,
    coin: "BTC",
    dir: "Open Long",
    side: "buy",
    notionalUsd: 12_400,
    sizeCoin: 0.17,
    avgPx: 74_650,
    closedPnl: 0,
    time: 1_000_000,
    read: false,
    ...overrides,
  };
}

describe("noticeFromFeedItem", () => {
  it("copies the order fields and starts unread", () => {
    const [aggregate] = aggregateFills([
      makeFill({ oid: 7, tid: 70, px: 100, sz: 1, time: 5_000 }),
      makeFill({ oid: 7, tid: 71, px: 200, sz: 1, time: 6_000, closedPnl: 3 }),
    ]);
    const item = toFeedItem(aggregate, A.toUpperCase().replace("0X", "0x"), true);
    expect(noticeFromFeedItem(item)).toEqual({
      id: item.id,
      address: A,
      coin: "BTC",
      dir: "Open Long",
      side: "buy",
      notionalUsd: 300,
      sizeCoin: 2,
      avgPx: 150,
      closedPnl: 3,
      time: 6_000,
      read: false,
    });
  });
});

describe("parseNotices", () => {
  it("returns an empty list for a missing value, bad JSON or a value that is not an array", () => {
    expect(parseNotices(null)).toEqual([]);
    expect(parseNotices("{nope")).toEqual([]);
    expect(parseNotices('{"a":1}')).toEqual([]);
  });

  it("drops bad entries and repeated ids, and sorts newest first", () => {
    const older = notice({ id: "a", time: 1 });
    const newer = notice({ id: "b", time: 2 });
    const raw = JSON.stringify([
      older,
      { ...newer, notionalUsd: "12" },
      newer,
      { ...newer, time: 3 },
      { ...older, id: "c", address: "0x12" },
      42,
    ]);
    expect(parseNotices(raw)).toEqual([newer, older]);
  });

  it("caps the list at 50", () => {
    const many = Array.from({ length: 60 }, (_, index) => notice({ id: `n${index}`, time: index }));
    const parsed = parseNotices(JSON.stringify(many));
    expect(parsed).toHaveLength(MAX_NOTICES);
    expect(parsed[0].id).toBe("n59");
  });
});

describe("addNotices", () => {
  it("adds new notices newest first", () => {
    const list = addNotices([notice({ id: "a", time: 1 })], [notice({ id: "b", time: 2 })]);
    expect(list.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("replaces a known id but keeps its read state", () => {
    const list = addNotices(
      [notice({ id: "a", read: true, notionalUsd: 100 })],
      [notice({ id: "a", notionalUsd: 300 })],
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "a", read: true, notionalUsd: 300 });
  });

  it("keeps the cap and drops the oldest", () => {
    const full = Array.from({ length: MAX_NOTICES }, (_, index) =>
      notice({ id: `n${index}`, time: index + 10 }),
    );
    const list = addNotices(full, [
      notice({ id: "new", time: 1_000 }),
      notice({ id: "old", time: 1 }),
    ]);
    expect(list).toHaveLength(MAX_NOTICES);
    expect(list[0].id).toBe("new");
    expect(list.some((entry) => entry.id === "old")).toBe(false);
    expect(list.some((entry) => entry.id === "n0")).toBe(false);
  });

  it("does not change the input list", () => {
    const list = [notice({ id: "a" })];
    addNotices(list, [notice({ id: "b" })]);
    expect(list).toHaveLength(1);
  });
});

describe("read state", () => {
  const list = [notice({ id: "a" }), notice({ id: "b" }), notice({ id: "c", read: true })];

  it("counts unread notices", () => {
    expect(unreadCount(list)).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  it("marks one notice read", () => {
    expect(unreadCount(markRead(list, "a"))).toBe(1);
    expect(markRead(list, "a")[1]).toBe(list[1]);
  });

  it("marks all notices read", () => {
    expect(unreadCount(markAllRead(list))).toBe(0);
  });

  it("clears the list", () => {
    expect(clearNotices()).toEqual([]);
  });

  it("caps the badge at 9+", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(3)).toBe("3");
    expect(unreadBadge(9)).toBe("9");
    expect(unreadBadge(10)).toBe("9+");
  });
});

describe("noticeText", () => {
  it("builds a title with the label, action and coin, and a body with size and age", () => {
    expect(noticeText(notice(), "testooor.hl", 1_000_000 + 120_000)).toEqual({
      title: "testooor.hl opened long BTC",
      body: "$12.4K · 0.17 BTC @ 74,650.00 · 2m ago",
    });
  });

  it("describes closes, flips and liquidations", () => {
    expect(noticeText(notice({ dir: "Close Short" }), "x", 1_000_000).title).toBe(
      "x closed short BTC",
    );
    expect(noticeText(notice({ dir: "Long > Short" }), "x", 1_000_000).title).toBe(
      "x flipped to short BTC",
    );
    expect(noticeText(notice({ dir: "Liquidated Isolated Long" }), "x", 1_000_000).title).toBe(
      "x was liquidated BTC",
    );
  });

  it("shows 0s ago for a fill time after the clock", () => {
    expect(noticeText(notice(), "x", 0).body.endsWith("0s ago")).toBe(true);
  });
});

describe("collapseBurst", () => {
  const batch = (count: number) =>
    Array.from({ length: count }, (_, index) => notice({ id: `n${index}` }));

  it("shows up to 3 toasts one by one", () => {
    const decision = collapseBurst(batch(3), INITIAL_BURST_STATE, 1_000);
    expect(decision.kind).toBe("each");
    if (decision.kind === "each") expect(decision.notices).toHaveLength(3);
    expect(decision.state.shownAt).toEqual([1_000, 1_000, 1_000]);
  });

  it("collapses more than 3 notices in one batch into one summary", () => {
    const decision = collapseBurst(batch(5), INITIAL_BURST_STATE, 1_000);
    expect(decision).toMatchObject({ kind: "summary", count: 5 });
    expect(burstText(5)).toBe("5 new trades from traders you follow");
    expect(burstText(1)).toBe("1 new trade from traders you follow");
  });

  it("collapses when earlier toasts inside the window push the total above 3", () => {
    let decision = collapseBurst(batch(2), INITIAL_BURST_STATE, 1_000);
    decision = collapseBurst(batch(1), decision.state, 2_000);
    expect(decision.kind).toBe("each");
    decision = collapseBurst(batch(2), decision.state, 3_000);
    expect(decision).toMatchObject({ kind: "summary", count: 2 });
  });

  it("counts up the open summary while the burst goes on", () => {
    let decision = collapseBurst(batch(4), INITIAL_BURST_STATE, 1_000);
    decision = collapseBurst(batch(2), decision.state, 4_000);
    expect(decision).toMatchObject({ kind: "summary", count: 6 });
    decision = collapseBurst(batch(1), decision.state, 8_000);
    expect(decision).toMatchObject({ kind: "summary", count: 7 });
  });

  it("ends the burst after a quiet window", () => {
    let decision = collapseBurst(batch(4), INITIAL_BURST_STATE, 1_000);
    decision = collapseBurst(batch(1), decision.state, 6_000);
    expect(decision.kind).toBe("each");
    expect(decision.state).toEqual({ shownAt: [6_000], summaryCount: 0 });
  });

  it("accepts a custom window and maximum", () => {
    expect(collapseBurst(batch(2), INITIAL_BURST_STATE, 0, 1_000, 1).kind).toBe("summary");
    expect(collapseBurst(batch(1), INITIAL_BURST_STATE, 0, 1_000, 1).kind).toBe("each");
  });

  it("shows nothing for an empty batch", () => {
    const decision = collapseBurst([], INITIAL_BURST_STATE, 0);
    expect(decision).toMatchObject({ kind: "each", notices: [] });
  });
});

describe("shouldShowBrowserNotice", () => {
  const base = { enabled: true, permission: "granted", visibility: "hidden" } as const;

  it("fires only when enabled, granted and hidden", () => {
    expect(shouldShowBrowserNotice(base)).toBe(true);
    expect(shouldShowBrowserNotice({ ...base, enabled: false })).toBe(false);
    expect(shouldShowBrowserNotice({ ...base, permission: "default" })).toBe(false);
    expect(shouldShowBrowserNotice({ ...base, permission: "denied" })).toBe(false);
    expect(shouldShowBrowserNotice({ ...base, permission: "unsupported" })).toBe(false);
    expect(shouldShowBrowserNotice({ ...base, visibility: "visible" })).toBe(false);
  });
});
