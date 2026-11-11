import type { Network, Watch } from "./schemas";
import {
  subscriptionRowSchema,
  watchRowSchema,
  type SubscriptionRow,
  type WatchRow,
} from "./schemas";
import { DELIVERY_RETENTION_MS, type Cursor } from "./watcher";

/*
 * The thin D1 layer. Each function makes one D1 call (a batch counts as
 * one), because Workers Free allows 50 subrequests per invocation and D1
 * queries count. Rows go through zod.
 */

const MAX_PARAMS = 100;

export interface UpsertInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  network: Network;
  minNotional: number;
  watches: readonly Watch[];
}

/** Insert or update a subscription by endpoint and replace its watches. Returns the id. */
export async function upsertSubscription(
  db: D1Database,
  input: UpsertInput,
  now: number,
): Promise<string> {
  const id = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO subscriptions (id, endpoint, p256dh, auth, network, min_notional, created_at, updated_at, failures)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh = excluded.p256dh, auth = excluded.auth, network = excluded.network,
           min_notional = excluded.min_notional, updated_at = excluded.updated_at, failures = 0
         RETURNING id`,
      )
      .bind(id, input.endpoint, input.p256dh, input.auth, input.network, input.minNotional, now),
    db
      .prepare(
        "DELETE FROM watches WHERE subscription_id = (SELECT id FROM subscriptions WHERE endpoint = ?1)",
      )
      .bind(input.endpoint),
    ...input.watches.map((watch) =>
      db
        .prepare(
          "INSERT INTO watches (subscription_id, address, label) SELECT id, ?2, ?3 FROM subscriptions WHERE endpoint = ?1",
        )
        .bind(input.endpoint, watch.address, watch.label),
    ),
  ];
  const [first] = await db.batch<{ id: string }>(statements);
  return first?.results[0]?.id ?? id;
}

function deleteStatements(db: D1Database, subscriptionId: string): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM watches WHERE subscription_id = ?1").bind(subscriptionId),
    db.prepare("DELETE FROM deliveries WHERE subscription_id = ?1").bind(subscriptionId),
    db.prepare("DELETE FROM subscriptions WHERE id = ?1").bind(subscriptionId),
  ];
}

export async function findSubscription(
  db: D1Database,
  endpoint: string,
): Promise<SubscriptionRow | null> {
  const row = await db
    .prepare("SELECT id, endpoint, p256dh, auth, failures FROM subscriptions WHERE endpoint = ?1")
    .bind(endpoint)
    .first();
  if (row === null) return null;
  const parsed = subscriptionRowSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/** Remove a subscription with its watches and deliveries. True when it existed. */
export async function deleteSubscriptionByEndpoint(
  db: D1Database,
  endpoint: string,
): Promise<boolean> {
  const sub = "(SELECT id FROM subscriptions WHERE endpoint = ?1)";
  const results = await db.batch([
    db.prepare(`DELETE FROM watches WHERE subscription_id = ${sub}`).bind(endpoint),
    db.prepare(`DELETE FROM deliveries WHERE subscription_id = ${sub}`).bind(endpoint),
    db.prepare("DELETE FROM subscriptions WHERE endpoint = ?1").bind(endpoint),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}

/** Apply the result of one test push. */
export async function applyTestResult(
  db: D1Database,
  subscriptionId: string,
  outcome: "sent" | "gone" | "failed",
): Promise<void> {
  if (outcome === "gone") await db.batch(deleteStatements(db, subscriptionId));
  else if (outcome === "sent") {
    await db
      .prepare("UPDATE subscriptions SET failures = 0 WHERE id = ?1")
      .bind(subscriptionId)
      .run();
  }
}

/** Every watch with its subscription and its cursor. */
export async function loadWatchRows(db: D1Database): Promise<WatchRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.network, s.min_notional, s.failures,
              w.address, w.label, c.last_time, c.seen_tids, c.polled_at
       FROM watches w
       JOIN subscriptions s ON s.id = w.subscription_id
       LEFT JOIN cursors c ON c.network = s.network AND c.address = w.address`,
    )
    .all();
  const rows: WatchRow[] = [];
  for (const row of results) {
    const parsed = watchRowSchema.safeParse(row);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

/** The deliveries of these items, as `subscription|item` keys. One batch. */
export async function loadDelivered(
  db: D1Database,
  itemIds: readonly string[],
): Promise<Set<string>> {
  const delivered = new Set<string>();
  if (itemIds.length === 0) return delivered;
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < itemIds.length; start += MAX_PARAMS) {
    const chunk = itemIds.slice(start, start + MAX_PARAMS);
    statements.push(
      db
        .prepare(
          `SELECT subscription_id, item_id FROM deliveries WHERE item_id IN (${chunk.map(() => "?").join(", ")})`,
        )
        .bind(...chunk),
    );
  }
  const results = await db.batch<{ subscription_id: string; item_id: string }>(statements);
  for (const result of results) {
    for (const row of result.results) delivered.add(`${row.subscription_id}|${row.item_id}`);
  }
  return delivered;
}

export interface TickWrites {
  cursors: { network: Network; address: string; cursor: Cursor; polledAt: number }[];
  /** Only the poll time changes (a failed poll or an unfinished address). */
  polled: { network: Network; address: string; polledAt: number }[];
  deliveries: { subscriptionId: string; itemId: string }[];
  failures: { subscriptionId: string; failures: number }[];
  resetFailures: string[];
  removals: string[];
}

/** Write the results of one tick and prune old rows, in one batch. */
export async function commitTick(db: D1Database, writes: TickWrites, now: number): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const { network, address, cursor, polledAt } of writes.cursors) {
    statements.push(
      db
        .prepare(
          `INSERT INTO cursors (network, address, last_time, seen_tids, polled_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(network, address) DO UPDATE SET
             last_time = excluded.last_time, seen_tids = excluded.seen_tids, polled_at = excluded.polled_at`,
        )
        .bind(network, address, cursor.lastTime, JSON.stringify(cursor.seenTids), polledAt),
    );
  }
  for (const { network, address, polledAt } of writes.polled) {
    statements.push(
      db
        .prepare("UPDATE cursors SET polled_at = ?3 WHERE network = ?1 AND address = ?2")
        .bind(network, address, polledAt),
    );
  }
  for (const { subscriptionId, itemId } of writes.deliveries) {
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO deliveries (subscription_id, item_id, sent_at) VALUES (?1, ?2, ?3)",
        )
        .bind(subscriptionId, itemId, now),
    );
  }
  for (const { subscriptionId, failures } of writes.failures) {
    statements.push(
      db
        .prepare("UPDATE subscriptions SET failures = ?2 WHERE id = ?1")
        .bind(subscriptionId, failures),
    );
  }
  for (const subscriptionId of writes.resetFailures) {
    statements.push(
      db.prepare("UPDATE subscriptions SET failures = 0 WHERE id = ?1").bind(subscriptionId),
    );
  }
  for (const subscriptionId of writes.removals)
    statements.push(...deleteStatements(db, subscriptionId));
  statements.push(
    db.prepare("DELETE FROM deliveries WHERE sent_at < ?1").bind(now - DELIVERY_RETENTION_MS),
    // Cursors of addresses that nobody watches any more.
    db.prepare(
      `DELETE FROM cursors WHERE NOT EXISTS (
         SELECT 1 FROM watches w JOIN subscriptions s ON s.id = w.subscription_id
         WHERE s.network = cursors.network AND w.address = cursors.address)`,
    ),
  );
  await db.batch(statements);
}
