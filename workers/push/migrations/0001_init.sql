-- Push subscription store. The only server-side state of Slipstream.

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  min_notional REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE watches (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  label TEXT,
  PRIMARY KEY (subscription_id, address)
);

CREATE INDEX watches_address ON watches(address);

-- One cursor per watched address and network.
-- last_time: the newest fill time seen (ms).
-- seen_tids: JSON array of the tids at last_time (boundary de-dupe).
-- polled_at: the last poll (ms), so that every address gets a turn.
CREATE TABLE cursors (
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  last_time INTEGER NOT NULL,
  seen_tids TEXT NOT NULL,
  polled_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (network, address)
);

-- item_id: network:user:oid. Rows older than 2 days are pruned on each tick.
CREATE TABLE deliveries (
  subscription_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (subscription_id, item_id)
);

CREATE INDEX deliveries_sent_at ON deliveries(sent_at);
