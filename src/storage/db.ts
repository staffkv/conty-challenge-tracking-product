import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  tracking_code TEXT NOT NULL,
  carrier TEXT NOT NULL,
  transit_limit_hours INTEGER,
  reference TEXT,
  created_at TEXT NOT NULL,
  last_synced_at TEXT,
  UNIQUE (carrier, tracking_code)
);

CREATE TABLE IF NOT EXISTS tracking_events (
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  event_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT,
  raw_status TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  received_at TEXT NOT NULL,
  PRIMARY KEY (shipment_id, event_key)
);

CREATE TABLE IF NOT EXISTS delay_alerts (
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  late_since TEXT NOT NULL,
  limit_hours INTEGER NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolution TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shipment_id, kind)
);
`;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
