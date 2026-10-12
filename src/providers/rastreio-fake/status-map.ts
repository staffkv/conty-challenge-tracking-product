import type { NormalizedStatus } from "../../domain/types.ts";

/**
 * Tradução por transportadora, por código exato. Não há busca por palavra nem
 * valor padrão: "Entrega não realizada" e "Entregue ao remetente" contêm
 * "entreg" e não são entregas. Código fora da tabela devolve null.
 * A mensagem do checkpoint nunca é usada para decidir o status.
 */
export const STATUS_MAPS: Record<string, Record<string, NormalizedStatus>> = {
  correios: {
    PO: "postado",
    RO: "em_transito",
    DO: "em_transito",
    OEC: "saiu_para_entrega",
    BDE: "entregue",
    "BDI-AUSENTE": "excecao",
    "BDE-REMETENTE": "excecao",
    "FC-EXTRAVIO": "excecao",
  },
  jadlog: {
    EMISSAO: "postado",
    TRANSFERENCIA: "em_transito",
    "EM ROTA": "saiu_para_entrega",
    ENTREGUE: "entregue",
    INSUCESSO: "excecao",
    DEVOLVIDO: "excecao",
  },
  loggi: {
    PICKED_UP: "postado",
    IN_TRANSIT: "em_transito",
    OUT_FOR_DELIVERY: "saiu_para_entrega",
    DELIVERED: "entregue",
    DELIVERY_FAILED: "excecao",
    RETURNED_TO_SENDER: "excecao",
  },
};

/** Ignora só caixa, acentos e espaços repetidos. */
export function normalizeCode(code: string): string {
  return code.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function translateStatus(carrier: string, code: string): NormalizedStatus | null {
  const table = STATUS_MAPS[carrier];
  if (!table) return null;
  return Object.hasOwn(table, normalizeCode(code)) ? table[normalizeCode(code)]! : null;
}
