import type { DatabaseSync } from "node:sqlite";
import type { NormalizedStatus } from "../domain/types.ts";

export type Shipment = {
  id: string;
  tracking_code: string;
  carrier: string;
  transit_limit_days: number | null;
  reference: string | null;
  created_at: string;
  last_synced_at: string | null;
};

export type StoredEvent = {
  event_key: string;
  occurred_at: string;
  status: NormalizedStatus | null;
  raw_status: string;
  description: string;
  location: string | null;
  received_at: string;
};

export type AlertStatus = "ativo" | "entregue_com_atraso" | "desfeito";

export type DelayAlert = {
  shipment_id: string;
  kind: string;
  status: AlertStatus;
  late_since: string;
  limit_days: number;
  opened_at: string;
  updated_at: string;
  resolution: string | null;
  stale: number;
};

export class Repository {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  findShipment(id: string): Shipment | undefined {
    return this.db.prepare("SELECT * FROM shipments WHERE id = ?").get(id) as Shipment | undefined;
  }

  findShipmentByCode(carrier: string, trackingCode: string): Shipment | undefined {
    return this.db.prepare("SELECT * FROM shipments WHERE carrier = ? AND tracking_code = ?").get(carrier, trackingCode) as
      | Shipment
      | undefined;
  }

  /** Mesmo código em transportadoras diferentes são encomendas diferentes. */
  findShipmentsByCode(trackingCode: string, carrier?: string): Shipment[] {
    if (carrier) return this.db.prepare("SELECT * FROM shipments WHERE tracking_code = ? AND carrier = ? ORDER BY created_at, id").all(trackingCode, carrier) as Shipment[];
    return this.db.prepare("SELECT * FROM shipments WHERE tracking_code = ? ORDER BY created_at, id").all(trackingCode) as Shipment[];
  }

  /** Devolve false se o par (transportadora, código) já existia. */
  insertShipment(s: Shipment): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO shipments (id, tracking_code, carrier, transit_limit_days, reference, created_at, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (carrier, tracking_code) DO NOTHING`,
      )
      .run(s.id, s.tracking_code, s.carrier, s.transit_limit_days, s.reference, s.created_at, s.last_synced_at);
    return result.changes > 0;
  }

  setLastSynced(id: string, at: string): void {
    this.db.prepare("UPDATE shipments SET last_synced_at = ? WHERE id = ?").run(at, id);
  }

  /** Encomendas sem nenhum evento de entrega. */
  listUndelivered(): Shipment[] {
    return this.db
      .prepare(
        `SELECT * FROM shipments s
         WHERE NOT EXISTS (SELECT 1 FROM tracking_events e WHERE e.shipment_id = s.id AND e.status = 'entregue')
         ORDER BY s.created_at, s.id`,
      )
      .all() as Shipment[];
  }

  /** Grava só o que ainda não existe; devolve quantos eventos eram novos. */
  insertEvents(shipmentId: string, events: readonly StoredEvent[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO tracking_events (shipment_id, event_key, occurred_at, status, raw_status, description, location, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (shipment_id, event_key) DO NOTHING`,
    );
    let inserted = 0;
    for (const e of events) {
      inserted += Number(
        stmt.run(shipmentId, e.event_key, e.occurred_at, e.status, e.raw_status, e.description, e.location, e.received_at).changes,
      );
    }
    return inserted;
  }

  listEvents(shipmentId: string): StoredEvent[] {
    return this.db
      .prepare(
        `SELECT event_key, occurred_at, status, raw_status, description, location, received_at
         FROM tracking_events WHERE shipment_id = ? ORDER BY occurred_at, event_key`,
      )
      .all(shipmentId) as StoredEvent[];
  }

  getAlert(shipmentId: string, kind: string): DelayAlert | undefined {
    return this.db.prepare("SELECT * FROM delay_alerts WHERE shipment_id = ? AND kind = ?").get(shipmentId, kind) as
      | DelayAlert
      | undefined;
  }

  /** Devolve false se o alerta já existia: quem chama só avisa quando cria. */
  insertAlert(a: DelayAlert): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO delay_alerts (shipment_id, kind, status, late_since, limit_days, opened_at, updated_at, resolution, stale)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (shipment_id, kind) DO NOTHING`,
      )
      .run(a.shipment_id, a.kind, a.status, a.late_since, a.limit_days, a.opened_at, a.updated_at, a.resolution, a.stale);
    return result.changes > 0;
  }

  updateAlert(shipmentId: string, kind: string, fields: Pick<DelayAlert, "status" | "late_since" | "updated_at" | "resolution" | "stale">): void {
    this.db
      .prepare(
        "UPDATE delay_alerts SET status = ?, late_since = ?, updated_at = ?, resolution = ?, stale = ? WHERE shipment_id = ? AND kind = ?",
      )
      .run(fields.status, fields.late_since, fields.updated_at, fields.resolution, fields.stale, shipmentId, kind);
  }

  listAlerts(): Array<DelayAlert & { tracking_code: string; carrier: string; reference: string | null }> {
    return this.db
      .prepare(
        `SELECT a.*, s.tracking_code, s.carrier, s.reference FROM delay_alerts a
         JOIN shipments s ON s.id = a.shipment_id ORDER BY a.opened_at, a.shipment_id`,
      )
      .all() as Array<DelayAlert & { tracking_code: string; carrier: string; reference: string | null }>;
  }
}
