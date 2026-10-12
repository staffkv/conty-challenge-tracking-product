import { describe, expect, it } from "vitest";
import { UnsupportedCarrierError } from "../src/tracking/service.ts";
import { buildService, PROVIDERS, type Spec } from "./helpers/harness.ts";

const CODE = "QB123456789BR";

const PO: Spec = { at: "2026-10-01T13:00:00Z", raw: "PO", status: "postado", location: "AGF Pinheiros - SP" };
const RO1: Spec = { at: "2026-10-01T21:20:00Z", raw: "RO", status: "em_transito", location: "CTE Vila Maria - SP" };
const RO2: Spec = { at: "2026-10-02T11:40:00Z", raw: "RO", status: "em_transito", location: "CTE Cajamar - SP" };
const OEC: Spec = { at: "2026-10-03T10:15:00Z", raw: "OEC", status: "saiu_para_entrega", location: "CDD Campinas - SP" };
const BDE: Spec = { at: "2026-10-03T17:00:00Z", raw: "BDE", status: "entregue", location: "Campinas - SP" };

describe.each(Object.entries(PROVIDERS))("serviço de rastreio com %s", (_name, makeHarness) => {
  async function setup(options?: { now?: string; defaultLimitDays?: number }) {
    const harness = makeHarness();
    const ctx = buildService(harness, options);
    const { view } = await ctx.service.register({ trackingCode: CODE, carrier: "correios" });
    return { ...ctx, harness, id: view.id };
  }

  describe("consultar de novo não duplica o histórico", () => {
    it("duas consultas com os mesmos eventos deixam o mesmo histórico", async () => {
      const { service, harness, id } = await setup();
      harness.publish(CODE, [PO, RO1, RO2]);
      const first = await service.refresh(id);
      const second = await service.refresh(id);
      expect(first?.history).toHaveLength(3);
      expect(second?.history).toEqual(first?.history);
    });

    it("o mesmo evento repetido no payload e reenviado com outro id é gravado uma vez", async () => {
      const { service, harness, id } = await setup();
      harness.publish(CODE, [PO, RO1, RO1]);
      await service.refresh(id);
      harness.publish(CODE, [RO1, PO]);
      const view = await service.refresh(id);
      expect(view?.history.map((h) => h.raw_status)).toEqual(["PO", "RO"]);
    });

    it("cadastrar de novo devolve a mesma encomenda", async () => {
      const { service, id } = await setup();
      const again = await service.register({ trackingCode: CODE, carrier: "correios" });
      expect(again.created).toBe(false);
      expect(again.view.id).toBe(id);
    });
  });

  describe("eventos fora de ordem", () => {
    it("evento antigo que chega numa consulta posterior não faz o status voltar", async () => {
      const { service, harness, id } = await setup({ now: "2026-10-03T12:00:00Z" });
      harness.publish(CODE, [OEC]);
      expect((await service.refresh(id))?.status).toBe("saiu_para_entrega");
      harness.publish(CODE, [RO2, PO]);
      const view = await service.refresh(id);
      expect(view?.status).toBe("saiu_para_entrega");
      expect(view?.history.map((h) => h.raw_status)).toEqual(["PO", "RO", "OEC"]);
      expect(view?.posted_at).toBe("2026-10-01T13:00:00Z");
    });

    it("entregue que chega antes dos eventos de trânsito continua entregue", async () => {
      const { service, harness, id } = await setup({ now: "2026-10-04T00:00:00Z" });
      harness.publish(CODE, [BDE, RO1, PO, OEC]);
      expect((await service.refresh(id))?.status).toBe("entregue");
    });
  });

  describe("status que a transportadora inventou", () => {
    it("não vira entregue: fica no histórico, não muda o status e é contado", async () => {
      const { service, harness, id } = await setup({ now: "2026-10-03T12:00:00Z" });
      harness.publish(CODE, [
        PO,
        RO2,
        { at: "2026-10-03T11:00:00Z", raw: "BDE-PENDENTE", status: null, message: "Objeto entregue? aguardando confirmação" },
      ]);
      const view = await service.refresh(id);
      expect(view?.status).toBe("em_transito");
      expect(view?.delivered_at).toBeNull();
      expect(view?.unmapped_events).toBe(1);
      expect(view?.history.at(-1)).toMatchObject({ raw_status: "BDE-PENDENTE", status: null });
    });

    it("só com status desconhecido, o status fica vazio e o motivo explica", async () => {
      const { service, harness, id } = await setup();
      harness.publish(CODE, [{ at: "2026-10-01T10:00:00Z", raw: "RX9", status: null }]);
      const view = await service.refresh(id);
      expect(view?.status).toBeNull();
      expect(view?.status_reason).toMatch(/1 evento com status que não conhecemos/);
      expect(view?.delay.elapsed_days).toBeNull();
      expect(view?.delay.summary).toMatch(/não começou/);
    });

    it("entregue ao remetente é exceção, não entrega", async () => {
      const { service, harness, id } = await setup();
      harness.publish(CODE, [PO, { at: "2026-10-05T19:00:00Z", raw: "BDE-remetente", status: "excecao", message: "Objeto entregue ao remetente" }]);
      const view = await service.refresh(id);
      expect(view?.status).toBe("excecao");
      expect(view?.delivered_at).toBeNull();
    });
  });

  describe("aviso de atraso com relógio fixo", () => {
    it("avisa uma vez quando passa do limite, mesmo rodando o monitor várias vezes", async () => {
      const { service, harness, clock, notifications, id } = await setup();
      harness.publish(CODE, [PO, RO1]);

      clock.set("2026-10-04T13:00:00Z"); // exatamente 72 h depois da postagem
      await service.checkDelays();
      expect(notifications).toHaveLength(0);

      clock.set("2026-10-04T13:01:00Z");
      await service.checkDelays();
      await service.checkDelays();
      expect(notifications.map((n) => n.kind)).toEqual(["atraso_aberto"]);
      expect(notifications[0]).toMatchObject({ shipment_id: id, late_since: "2026-10-04T13:00:00Z", limit_days: 3 });
      expect(notifications[0]?.message).toBe("Postado há 3 dias e 1 min e ainda sem entrega; passou do limite de 3 dias em 04/10/2026 às 10:00.");

      const view = await service.refresh(id);
      expect(view?.delay).toMatchObject({ late: true, alert: "ativo" });
    });

    it("desfaz o alerta, com motivo, quando chega uma entrega que ocorreu dentro do limite", async () => {
      const { service, harness, clock, notifications, id } = await setup();
      harness.publish(CODE, [PO, RO1]);
      clock.set("2026-10-06T00:00:00Z");
      await service.checkDelays();

      // A entrega foi em 03/10, mas o evento só chegou agora.
      harness.publish(CODE, [BDE]);
      const view = await service.refresh(id);
      expect(view?.delay).toMatchObject({ late: false, alert: "desfeito", elapsed_days: 2.2 });
      expect(notifications.map((n) => n.kind)).toEqual(["atraso_aberto", "atraso_desfeito"]);
      expect(service.listAlerts()[0]?.resolution).toMatch(/A entrega aconteceu em 03\/10\/2026 às 14:00, com 2 dias e 4 h de trânsito, dentro do limite de 3 dias/);

      await service.checkDelays();
      expect(notifications).toHaveLength(2);
    });

    it("entrega normal consultada muito depois não gera aviso", async () => {
      const { service, harness, clock, notifications, id } = await setup();
      harness.publish(CODE, [PO, RO1, RO2, OEC, BDE]);
      clock.set("2026-11-30T00:00:00Z");
      const view = await service.refresh(id);
      await service.checkDelays();
      expect(view?.delay).toMatchObject({ late: false, elapsed_days: 2.2, summary: "Entregue em 2 dias e 4 h, dentro do limite de 3 dias." });
      expect(notifications).toHaveLength(0);
    });

    it("a espera entre o cadastro e a postagem não conta como trânsito", async () => {
      const { service, harness, clock, notifications, id } = await setup({ now: "2026-09-20T00:00:00Z" });
      clock.set("2026-10-02T13:00:00Z");
      harness.publish(CODE, [PO]);
      const view = await service.refresh(id);
      expect(view?.delay).toMatchObject({ late: false, elapsed_days: 1, summary: "Postado há 1 dia; o limite é de 3 dias." });
      expect(notifications).toHaveLength(0);
    });

    it("respeita o limite próprio da encomenda", async () => {
      const harness = makeHarness();
      const { service, clock } = buildService(harness);
      const { view } = await service.register({ trackingCode: CODE, carrier: "correios", transitLimitDays: 1 });
      harness.publish(CODE, [PO]);
      clock.set("2026-10-02T14:00:00Z");
      const after = await service.refresh(view.id);
      expect(after?.delay).toMatchObject({ late: true, limit_days: 1, late_since: "2026-10-02T13:00:00Z" });
    });
  });

  describe("agregador fora do ar", () => {
    it("devolve o estado guardado marcado como desatualizado", async () => {
      const { service, harness, id } = await setup();
      harness.publish(CODE, [PO, RO1]);
      const before = await service.refresh(id);
      harness.setOffline(true);
      const view = await service.refresh(id);
      expect(view).toMatchObject({ stale: true, sync_error: "indisponivel", status: "em_transito" });
      expect(view?.history).toEqual(before?.history);
      expect(view?.last_synced_at).toBe(before?.last_synced_at);
    });
  });

  it("recusa transportadora que o provedor não suporta", async () => {
    const { service } = buildService(makeHarness());
    await expect(service.register({ trackingCode: CODE, carrier: "transportadora-x" })).rejects.toBeInstanceOf(UnsupportedCarrierError);
  });
});
