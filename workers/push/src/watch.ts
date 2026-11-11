import { commitTick, loadDelivered, loadWatchRows, type TickWrites } from "./db";
import { readConfig, readVapid, type Env } from "./env";
import { fetchFillsSince, type FetchFn } from "./hl";
import { sendPush } from "./push";
import {
  activeNetworks,
  advanceCursor,
  buildItems,
  classifyPushStatus,
  createBudget,
  cursorOrStart,
  mapLimit,
  newFills,
  nextFailures,
  planDeliveries,
  pollLimit,
  selectTargets,
  targetKey,
  type Cursor,
  type Item,
  type Target,
} from "./watcher";

/*
 * One watcher run, from the cron trigger (every minute) or POST /tick.
 * 1. Load every watch with its subscription and cursor (1 D1 call).
 * 2. Poll the least recently polled addresses (concurrency 5).
 * 3. Load the deliveries of the new items (1 D1 call) and plan the pushes.
 * 4. Send the pushes (concurrency 5).
 * 5. Write cursors, deliveries and failures, and prune (1 D1 call).
 * A cursor moves only when every push of its address went out (sent or
 * failed). When the request budget or the time runs out, the address keeps
 * its cursor and the next run continues; deliveries stop repeats.
 */

export const CONCURRENCY = 5;
/** Stop starting new work after this much wall time. */
export const WALL_TIME_LIMIT_MS = 25_000;

export interface TickStats {
  networks: string[];
  addressesWatched: number;
  addressesPolled: number;
  pollErrors: number;
  fillsSeen: number;
  itemsBuilt: number;
  pushesPlanned: number;
  pushesSent: number;
  pushesFailed: number;
  pushesDeferred: number;
  subscriptionsRemoved: number;
  ms: number;
}

export interface TickDeps {
  fetch?: FetchFn;
  now?: () => number;
}

interface PollResult {
  target: Target;
  status: "ok" | "error" | "skipped";
  cursor: Cursor | null;
  fills: number;
  items: Item[];
}

export async function runTick(env: Env, deps: TickDeps = {}): Promise<TickStats> {
  const fetchFn = deps.fetch ?? fetch;
  const clock = deps.now ?? Date.now;
  const started = clock();
  const config = readConfig(env);
  const vapid = readVapid(env);
  const budget = createBudget(config.maxSubrequestsPerTick);
  const outOfTime = () => clock() - started > WALL_TIME_LIMIT_MS;

  const rows = await loadWatchRows(env.DB);
  const networks = activeNetworks(rows);
  const allTargets = selectTargets(rows, Number.MAX_SAFE_INTEGER);
  const targets = allTargets.slice(
    0,
    pollLimit(config.maxAddressesPerTick, config.maxSubrequestsPerTick),
  );

  const polls = await mapLimit(targets, CONCURRENCY, async (target): Promise<PollResult> => {
    if (outOfTime() || !budget.take()) {
      return { target, status: "skipped", cursor: null, fills: 0, items: [] };
    }
    const cursor = cursorOrStart(target.cursor, started);
    try {
      const fills = await fetchFillsSince(target.network, target.address, cursor.lastTime, fetchFn);
      const fresh = newFills(fills, cursor);
      return {
        target,
        status: "ok",
        cursor: advanceCursor(cursor, fills),
        fills: fresh.length,
        items: buildItems(target.network, target.address, fresh),
      };
    } catch (error) {
      console.log(
        JSON.stringify({ event: "poll_error", address: target.address, message: String(error) }),
      );
      return { target, status: "error", cursor: null, fills: 0, items: [] };
    }
  });

  const items = polls.flatMap((poll) => poll.items);
  const delivered = await loadDelivered(
    env.DB,
    items.map((item) => item.id),
  );
  const planned = vapid ? planDeliveries({ items, rows, delivered, now: clock() }) : [];

  const writes: TickWrites = {
    cursors: [],
    polled: [],
    deliveries: [],
    failures: [],
    resetFailures: [],
    removals: [],
  };
  /** Addresses with a push that did not go out in this run. */
  const unfinished = new Set<string>();
  const failureCounts = new Map<string, number>();
  const removed = new Set<string>();
  const succeeded = new Set<string>();
  let pushesSent = 0;
  let pushesFailed = 0;
  let pushesDeferred = 0;

  await mapLimit(planned, CONCURRENCY, async (push) => {
    const subscriptionId = push.subscription.id;
    if (removed.has(subscriptionId)) return;
    if (!vapid || outOfTime() || !budget.take()) {
      pushesDeferred += 1;
      for (const key of push.targetKeys) unfinished.add(key);
      return;
    }
    const status = await sendPush(push.subscription, push.payload, vapid, fetchFn);
    const outcome = classifyPushStatus(status);
    if (outcome === "sent") {
      pushesSent += 1;
      succeeded.add(subscriptionId);
      for (const itemId of push.itemIds) writes.deliveries.push({ subscriptionId, itemId });
      return;
    }
    pushesFailed += 1;
    if (outcome === "gone") {
      removed.add(subscriptionId);
      return;
    }
    const current = failureCounts.get(subscriptionId) ?? push.subscription.failures;
    const next = nextFailures(current);
    failureCounts.set(subscriptionId, next.failures);
    if (next.remove) removed.add(subscriptionId);
  });

  const now = clock();
  for (const poll of polls) {
    const { network, address } = poll.target;
    if (poll.status === "skipped") continue;
    if (poll.status === "ok" && poll.cursor && !unfinished.has(targetKey(network, address))) {
      writes.cursors.push({ network, address, cursor: poll.cursor, polledAt: now });
    } else if (poll.target.cursor) {
      writes.polled.push({ network, address, polledAt: now });
    } else {
      // No cursor yet and nothing to keep: start it now, so history never notifies.
      writes.cursors.push({
        network,
        address,
        cursor: cursorOrStart(null, started),
        polledAt: now,
      });
    }
  }
  for (const [subscriptionId, failures] of failureCounts) {
    if (!removed.has(subscriptionId)) writes.failures.push({ subscriptionId, failures });
  }
  for (const subscriptionId of succeeded) {
    if (!failureCounts.has(subscriptionId) && !removed.has(subscriptionId)) {
      writes.resetFailures.push(subscriptionId);
    }
  }
  writes.removals.push(...removed);
  writes.deliveries = writes.deliveries.filter((delivery) => !removed.has(delivery.subscriptionId));
  await commitTick(env.DB, writes, now);

  const stats: TickStats = {
    networks,
    addressesWatched: allTargets.length,
    addressesPolled: polls.filter((poll) => poll.status !== "skipped").length,
    pollErrors: polls.filter((poll) => poll.status === "error").length,
    fillsSeen: polls.reduce((sum, poll) => sum + poll.fills, 0),
    itemsBuilt: items.length,
    pushesPlanned: planned.length,
    pushesSent,
    pushesFailed,
    pushesDeferred,
    subscriptionsRemoved: removed.size,
    ms: clock() - started,
  };
  console.log(JSON.stringify({ event: "tick", ...stats }));
  return stats;
}
