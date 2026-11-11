import { describe, expect, it } from "vitest";

import { noticeText, type Notice } from "@/lib/notifications";

import { noticeText as workerNoticeText } from "../workers/push/src/text";

/*
 * The push Worker keeps a small copy of the notice wording. This test keeps
 * both copies equal, so a push reads the same as an in-tab notice.
 */

const base: Notice = {
  id: "0x5b5d51203a0f9079f8aeb098a6523a13f298c060:1:1",
  address: "0x5b5d51203a0f9079f8aeb098a6523a13f298c060",
  coin: "BTC",
  dir: "Open Long",
  side: "buy",
  notionalUsd: 12_400,
  sizeCoin: 0.17,
  avgPx: 74_650,
  closedPnl: 0,
  time: 1_000_000,
  read: false,
};

const cases: Partial<Notice>[] = [
  {},
  { dir: "Close Short", coin: "SOL", notionalUsd: 55.45, sizeCoin: 0.66, avgPx: 84.018 },
  { dir: "Long > Short", notionalUsd: 146_792_255, sizeCoin: 1234.56789, avgPx: 0.116438 },
  { dir: "Short > Long", notionalUsd: 999.995 },
  { dir: "Liquidated Isolated Long", coin: "xyz:NVDA" },
  { dir: "Buy", coin: "@107", avgPx: 0.5 },
  { dir: "Sell" },
  { dir: "Something New", notionalUsd: 1_000_000_000 },
];

describe("push text parity", () => {
  it.each(cases)("matches the in-tab notice for %o", (overrides) => {
    const notice = { ...base, ...overrides };
    for (const now of [notice.time, notice.time + 45_000, notice.time + 7_200_000]) {
      expect(workerNoticeText(notice, "testooor.hl", now)).toEqual(
        noticeText(notice, "testooor.hl", now),
      );
    }
  });
});
