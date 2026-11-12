import { describe, expect, it } from "vitest";

import { isLeaderTab, LEADER_STALE_MS, runExclusive, type TabLocks } from "./tabLock";

/** A Web Locks stand-in with the `ifAvailable` rule, shared by every "tab" in the test. */
function fakeLocks(): TabLocks {
  const held = new Map<string, Promise<void>>();
  return {
    async request(name, options, callback) {
      while (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        await held.get(name);
      }
      let release = () => {};
      held.set(
        name,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      try {
        await callback({ name });
      } finally {
        held.delete(name);
        release();
      }
    },
  };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("runExclusive (Web Locks)", () => {
  it("runs one of two tabs and skips the other while the lock is held", async () => {
    const locks = fakeLocks();
    const gate = deferred();
    const sent: string[] = [];
    const tabA = runExclusive(
      "slipstream.trailing.testnet.0xabc.BTC",
      async () => {
        sent.push("A modify");
        await gate.promise;
      },
      { wait: false, locks },
    );
    const tabB = runExclusive(
      "slipstream.trailing.testnet.0xabc.BTC",
      async () => {
        sent.push("B modify");
      },
      { wait: false, locks },
    );
    expect(await tabB).toBe(false);
    gate.resolve();
    expect(await tabA).toBe(true);
    expect(sent).toEqual(["A modify"]);
  });

  it("does not block another coin", async () => {
    const locks = fakeLocks();
    const gate = deferred();
    const tabA = runExclusive("lock.BTC", () => gate.promise, { wait: false, locks });
    expect(await runExclusive("lock.ETH", async () => {}, { wait: false, locks })).toBe(true);
    gate.resolve();
    await tabA;
  });

  it("makes a user action wait for the lock instead of skipping", async () => {
    const locks = fakeLocks();
    const gate = deferred();
    const order: string[] = [];
    const tracker = runExclusive(
      "lock.BTC",
      async () => {
        order.push("tracker start");
        await gate.promise;
        order.push("tracker end");
      },
      { wait: false, locks },
    );
    const stop = runExclusive(
      "lock.BTC",
      async () => {
        order.push("stop");
      },
      { wait: true, locks },
    );
    gate.resolve();
    expect(await stop).toBe(true);
    await tracker;
    expect(order).toEqual(["tracker start", "tracker end", "stop"]);
  });

  it("passes an error of the work through and frees the lock", async () => {
    const locks = fakeLocks();
    await expect(
      runExclusive(
        "lock.BTC",
        async () => {
          throw new Error("boom");
        },
        { wait: false, locks },
      ),
    ).rejects.toThrow("boom");
    expect(await runExclusive("lock.BTC", async () => {}, { wait: false, locks })).toBe(true);
  });
});

describe("runExclusive (no Web Locks)", () => {
  it("runs the tracker only in the leader tab", async () => {
    let ran = 0;
    const work = async () => {
      ran += 1;
    };
    expect(await runExclusive("x", work, { wait: false, locks: null })).toBe(false);
    expect(await runExclusive("x", work, { wait: false, locks: null, isLeader: () => false })).toBe(
      false,
    );
    expect(await runExclusive("x", work, { wait: false, locks: null, isLeader: () => true })).toBe(
      true,
    );
    // A user action always runs.
    expect(await runExclusive("x", work, { wait: true, locks: null })).toBe(true);
    expect(ran).toBe(2);
  });
});

describe("isLeaderTab", () => {
  const T = 1_794_400_000_000;
  const self = { id: "m", startedAt: T };
  const after = T + LEADER_STALE_MS;

  it("waits a full stale period before it may lead", () => {
    expect(isLeaderTab(self, [], T + 1000)).toBe(false);
    expect(isLeaderTab(self, [], after)).toBe(true);
  });

  it("lets the oldest live tab lead; the id breaks a tie", () => {
    expect(isLeaderTab(self, [{ id: "a", startedAt: T - 1, at: after }], after)).toBe(false);
    expect(isLeaderTab(self, [{ id: "z", startedAt: T + 5, at: after }], after)).toBe(true);
    expect(isLeaderTab(self, [{ id: "a", startedAt: T, at: after }], after)).toBe(false);
    expect(isLeaderTab(self, [{ id: "z", startedAt: T, at: after }], after)).toBe(true);
  });

  it("takes over when the older tab is silent for the stale period", () => {
    const old = { id: "a", startedAt: T - 1, at: after - LEADER_STALE_MS - 1 };
    expect(isLeaderTab(self, [old], after)).toBe(true);
  });
});
