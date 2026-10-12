import { randomUUID } from "node:crypto";
import type { Clock } from "../clock.ts";
import { assessDelay, type DelayAssessment } from "../domain/delay.ts";
import { eventKey } from "../domain/event-key.ts";
import { currentStatus } from "../domain/status.ts";
import { ProviderError, type NormalizedStatus, type ProviderErrorKind, type TrackingProvider } from "../domain/types.ts";
import type { Logger } from "../log.ts";
import type { AlertStatus, DelayAlert, Repository, Shipment, StoredEvent } from "../storage/repository.ts";
import { brasilia, days, delaySummary, duration, isoSeconds, toDays } from "./format.ts";
import type { Notifier } from "./notifier.ts";

export const DELAY_ALERT = "transito_acima_do_limite";

export type TrackingDeps = {
  repo: Repository;
  provider: TrackingProvider;
  clock: Clock;
  notifier: Notifier;
  defaultLimitDays: number;
  log?: Logger;
  newId?: () => string;
};

export type RegisterInput = {
  trackingCode: string;
  carrier: string;
  transitLimitDays?: number;
  reference?: string;
};

export class UnsupportedCarrierError extends Error {
  constructor(readonly carrier: string) {
    super(`Transportadora não suportada: ${carrier}.`);
    this.name = "UnsupportedCarrierError";
  }
}

export type HistoryEntry = {
  occurred_at: string;
  status: NormalizedStatus | null;
  raw_status: string;
  description: string;
  location: string | null;
  received_at: string;
};

export type ShipmentView = {
  id: string;
  tracking_code: string;
  carrier: string;
  reference: string | null;
  status: NormalizedStatus | null;
  status_reason: string | null;
  posted_at: string | null;
  delivered_at: string | null;
  delay: {
    late: boolean;
    delivered_late: boolean;
    limit_days: number;
    elapsed_days: number | null;
    late_since: string | null;
    /** Frase pronta para mostrar a quem acompanha a campanha. */
    summary: string;
    alert: AlertStatus | null;
  };
  unmapped_events: number;
  history: HistoryEntry[];
  last_synced_at: string | null;
  stale: boolean;
  sync_error: ProviderErrorKind | null;
};

type SyncOutcome = { stale: boolean; error: ProviderErrorKind | null };

export class TrackingService {
  private readonly log: Logger;
  private readonly newId: () => string;

  constructor(private readonly deps: TrackingDeps) {
    this.log = deps.log ?? (() => {});
    this.newId = deps.newId ?? (() => `shp_${randomUUID()}`);
  }

  /**
   * Cadastra no agregador e grava. Mesmo código e transportadora devolvem o
   * existente, sem duplicar; o cadastro no agregador é refeito (ele é idempotente)
   * para o caso de o agregador ter perdido o código, e a encomenda é sincronizada.
   */
  async register(input: RegisterInput): Promise<{ created: boolean; view: ShipmentView }> {
    const { repo, provider, clock } = this.deps;
    const existing = repo.findShipmentByCode(input.carrier, input.trackingCode);
    if (existing) {
      try {
        await provider.register(existing.tracking_code, existing.carrier);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        this.log({ event: "recadastro_falhou", shipment_id: existing.id, kind: error.kind, message: error.message });
        return { created: false, view: this.finish(existing, { stale: true, error: error.kind }) };
      }
      return { created: false, view: this.finish(existing, await this.sync(existing)) };
    }
    if (!provider.supportsCarrier(input.carrier)) throw new UnsupportedCarrierError(input.carrier);

    await provider.register(input.trackingCode, input.carrier);
    const shipment: Shipment = {
      id: this.newId(),
      tracking_code: input.trackingCode,
      carrier: input.carrier,
      transit_limit_days: input.transitLimitDays ?? null,
      reference: input.reference ?? null,
      created_at: isoSeconds(clock.now()),
      last_synced_at: null,
    };
    const created = repo.insertShipment(shipment);
    const saved = created ? shipment : repo.findShipmentByCode(input.carrier, input.trackingCode)!;
    const outcome = await this.sync(saved);
    return { created, view: this.finish(saved, outcome) };
  }

  /** Sincroniza com o agregador e devolve o estado. Falha do agregador não apaga o que já se sabe. */
  async refresh(id: string): Promise<ShipmentView | null> {
    const shipment = this.deps.repo.findShipment(id);
    if (!shipment) return null;
    const outcome = await this.sync(shipment);
    return this.finish(shipment, outcome);
  }

  /** Busca pelo código de rastreio e sincroniza cada encomenda encontrada. */
  async findByCode(trackingCode: string, carrier?: string): Promise<ShipmentView[]> {
    const views: ShipmentView[] = [];
    for (const shipment of this.deps.repo.findShipmentsByCode(trackingCode, carrier)) {
      views.push(this.finish(shipment, await this.sync(shipment)));
    }
    return views;
  }

  /** Sincroniza as encomendas em aberto e avisa as que passaram do limite. */
  async checkDelays(): Promise<{ checked: number; late: number; stale: number }> {
    const summary = { checked: 0, late: 0, stale: 0 };
    for (const shipment of this.deps.repo.listUndelivered()) {
      const view = await this.refresh(shipment.id);
      summary.checked += 1;
      if (view?.delay.late) summary.late += 1;
      if (view?.stale) summary.stale += 1;
    }
    return summary;
  }

  listAlerts() {
    return this.deps.repo.listAlerts().map((a) => ({
      shipment_id: a.shipment_id,
      tracking_code: a.tracking_code,
      carrier: a.carrier,
      reference: a.reference,
      kind: a.kind,
      status: a.status,
      limit_days: a.limit_days,
      late_since: a.late_since,
      opened_at: a.opened_at,
      updated_at: a.updated_at,
      resolution: a.resolution,
      stale: a.stale === 1,
    }));
  }

  private async sync(shipment: Shipment): Promise<SyncOutcome> {
    const { repo, provider, clock } = this.deps;
    let events;
    try {
      events = await provider.fetchEvents(shipment.tracking_code, shipment.carrier);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      this.log({ event: "sincronizacao_falhou", shipment_id: shipment.id, kind: error.kind, message: error.message });
      return { stale: true, error: error.kind };
    }

    const receivedAt = isoSeconds(clock.now());
    const rows: StoredEvent[] = events.map((e) => ({
      event_key: eventKey(shipment.carrier, e),
      occurred_at: isoSeconds(e.occurredAt),
      status: e.status,
      raw_status: e.rawStatus,
      description: e.description,
      location: e.location,
      received_at: receivedAt,
    }));
    repo.transaction(() => {
      repo.insertEvents(shipment.id, rows);
      repo.setLastSynced(shipment.id, receivedAt);
    });
    return { stale: false, error: null };
  }

  private finish(shipment: Shipment, outcome: SyncOutcome): ShipmentView {
    const fresh = this.deps.repo.findShipment(shipment.id)!;
    const events = this.deps.repo.listEvents(fresh.id);
    const assessment = assessDelay(toDomain(events), this.limitFor(fresh), this.deps.clock.now());
    this.reconcileAlert(fresh, assessment, outcome.stale);
    return this.view(fresh, outcome, events, assessment);
  }

  private view(shipment: Shipment, outcome: SyncOutcome, events?: StoredEvent[], assessment?: DelayAssessment): ShipmentView {
    const rows = events ?? this.deps.repo.listEvents(shipment.id);
    const domain = toDomain(rows);
    const a = assessment ?? assessDelay(domain, this.limitFor(shipment), this.deps.clock.now());
    const status = currentStatus(rows.map((r, i) => ({ ...domain[i]!, key: r.event_key })));
    const unmapped = rows.filter((r) => r.status === null).length;
    const alert = this.deps.repo.getAlert(shipment.id, DELAY_ALERT);

    return {
      id: shipment.id,
      tracking_code: shipment.tracking_code,
      carrier: shipment.carrier,
      reference: shipment.reference,
      status,
      status_reason: status === null ? statusReason(unmapped) : null,
      posted_at: a.startedAt ? isoSeconds(a.startedAt) : null,
      delivered_at: a.deliveredAt ? isoSeconds(a.deliveredAt) : null,
      delay: {
        late: a.late,
        delivered_late: a.deliveredLate,
        limit_days: a.limitDays,
        elapsed_days: a.elapsedMs === null ? null : toDays(a.elapsedMs),
        late_since: a.lateSince ? isoSeconds(a.lateSince) : null,
        summary: delaySummary(a),
        alert: alert?.status ?? null,
      },
      unmapped_events: unmapped,
      history: rows.map(({ event_key: _key, ...rest }) => rest),
      last_synced_at: shipment.last_synced_at,
      stale: outcome.stale,
      sync_error: outcome.error,
    };
  }

  private limitFor(shipment: Shipment): number {
    return shipment.transit_limit_days ?? this.deps.defaultLimitDays;
  }

  /**
   * Mantém o alerta coerente com o recálculo. Avisa ao abrir e ao desfazer;
   * rodar de novo sem mudança não avisa outra vez.
   */
  private reconcileAlert(shipment: Shipment, a: DelayAssessment, stale: boolean): void {
    const { repo, clock, notifier } = this.deps;
    const now = isoSeconds(clock.now());
    const existing = repo.getAlert(shipment.id, DELAY_ALERT);

    if (a.late && a.lateSince) {
      const status: AlertStatus = a.deliveredAt ? "entregue_com_atraso" : "ativo";
      const lateSince = isoSeconds(a.lateSince);
      const fields = { status, late_since: lateSince, updated_at: now, resolution: null, stale: stale ? 1 : 0 };
      const message = delaySummary(a);

      if (!existing) {
        const alert: DelayAlert = { shipment_id: shipment.id, kind: DELAY_ALERT, opened_at: now, limit_days: a.limitDays, ...fields };
        if (repo.insertAlert(alert)) this.notify(shipment, "atraso_aberto", a, lateSince, message);
        return;
      }
      if (existing.status !== status || existing.late_since !== lateSince) {
        repo.updateAlert(shipment.id, DELAY_ALERT, fields);
        if (existing.status === "desfeito") this.notify(shipment, "atraso_aberto", a, lateSince, message);
      }
      return;
    }

    if (existing && existing.status !== "desfeito") {
      const resolution = a.deliveredAt
        ? `A entrega aconteceu em ${brasilia(a.deliveredAt)}, com ${duration(a.elapsedMs ?? 0)} de trânsito, dentro do limite de ${days(a.limitDays)}. O evento de entrega chegou depois do alerta.`
        : `O tempo em trânsito voltou a ficar dentro do limite de ${days(a.limitDays)}.`;
      repo.updateAlert(shipment.id, DELAY_ALERT, {
        status: "desfeito",
        late_since: existing.late_since,
        updated_at: now,
        resolution,
        stale: stale ? 1 : 0,
      });
      notifier.notify({
        kind: "atraso_desfeito",
        shipment_id: shipment.id,
        tracking_code: shipment.tracking_code,
        carrier: shipment.carrier,
        reference: shipment.reference,
        limit_days: a.limitDays,
        late_since: existing.late_since,
        elapsed_days: a.elapsedMs === null ? null : toDays(a.elapsedMs),
        message: resolution,
      });
    }
  }

  private notify(shipment: Shipment, kind: "atraso_aberto", a: DelayAssessment, lateSince: string, message: string): void {
    this.deps.notifier.notify({
      kind,
      shipment_id: shipment.id,
      tracking_code: shipment.tracking_code,
      carrier: shipment.carrier,
      reference: shipment.reference,
      limit_days: a.limitDays,
      late_since: lateSince,
      elapsed_days: a.elapsedMs === null ? null : toDays(a.elapsedMs),
      message,
    });
  }
}

function toDomain(rows: readonly StoredEvent[]) {
  return rows.map((r) => ({ occurredAt: new Date(r.occurred_at), status: r.status }));
}

function statusReason(unmapped: number): string {
  if (unmapped === 0) return "Nenhum evento da transportadora até agora.";
  const plural = unmapped === 1 ? "1 evento com status que não conhecemos" : `${unmapped} eventos com status que não conhecemos`;
  return `Nenhum evento reconhecido até agora. Há ${plural}; eles ficam no histórico e não mudam o status.`;
}
