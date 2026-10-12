import type { MockCheckpoint } from "./app.ts";

// Cenários da demonstração local, escolhidos pelo código de rastreio.

let seq = 0;
function cp(time: string, status: string, message: string, location: string | null = null, tz: string | null = null): MockCheckpoint {
  seq += 1;
  return { checkpoint_id: `cp_${seq.toString(16).padStart(4, "0")}`, checkpoint_time: time, checkpoint_tz: tz, courier_status: status, message, location };
}

/** Repetido, fora de ordem e com um status que a transportadora inventou. */
export const EXAMPLE_CHECKPOINTS: MockCheckpoint[] = [
  cp("2026-10-02 08:40:00", "RO", "Objeto em trânsito - por favor aguarde", "CTE Cajamar - SP", "-03:00"),
  cp("2026-10-01 10:02:00", "PO", "Objeto postado", "AGF Pinheiros - SP", "-03:00"),
  cp("2026-10-02 08:40:00", "RO", "Objeto em trânsito - por favor aguarde", "CTE Cajamar - SP", "-03:00"),
  cp("2026-10-03T07:15:00-03:00", "OEC", "Objeto saiu para entrega ao destinatário", "CDD Campinas - SP"),
  cp("2026-10-03 09:30:00", "RX9", "Objeto aguardando confirmação de entrega pelo destinatário", "CDD Campinas - SP", "-03:00"),
  cp("2026-10-01 18:20:00", "RO", "Objeto em trânsito - por favor aguarde", "CTE Vila Maria - SP", "-03:00"),
];

export const SCENARIOS: Record<string, MockCheckpoint[]> = {
  // Entrega normal, dentro do prazo.
  QB000000001BR: [
    cp("2026-10-01 10:00:00", "PO", "Objeto postado", "AGF Pinheiros - SP"),
    cp("2026-10-02 08:00:00", "RO", "Objeto em trânsito - por favor aguarde", "CTE Cajamar - SP"),
    cp("2026-10-03 07:00:00", "OEC", "Objeto saiu para entrega ao destinatário", "CDD Campinas - SP"),
    cp("2026-10-03 14:00:00", "BDE", "Objeto entregue ao destinatário", "Campinas - SP"),
  ],
  // Repetido, fora de ordem e com status inventado.
  QB000000002BR: EXAMPLE_CHECKPOINTS,
  // Parado em trânsito há dias: passa do limite.
  QB000000003BR: [
    cp("2026-09-20 10:00:00", "PO", "Objeto postado", "AGF Pinheiros - SP"),
    cp("2026-09-21 09:00:00", "RO", "Objeto em trânsito - por favor aguarde", "CTE Cajamar - SP"),
  ],
  // Devolvido: o texto diz "entregue", mas é ao remetente.
  QB000000004BR: [
    cp("2026-10-01 10:00:00", "PO", "Objeto postado", "AGF Pinheiros - SP"),
    cp("2026-10-05 16:00:00", "BDE-remetente", "Objeto entregue ao remetente", "AGF Pinheiros - SP"),
  ],
};
