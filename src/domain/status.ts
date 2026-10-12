import type { NormalizedStatus } from "./types.ts";

export type StatusInput = {
  occurredAt: Date;
  status: NormalizedStatus | null;
  key: string;
};

const PROGRESS: Record<Exclude<NormalizedStatus, "excecao">, number> = {
  postado: 1,
  em_transito: 2,
  saiu_para_entrega: 3,
  entregue: 4,
};

/**
 * Ordem total dos eventos reconhecidos. No mesmo instante, a exceção fica por
 * último (prefere mostrar o problema) e progresso maior vem depois do menor.
 * A chave desempata o resto, para que o resultado não dependa da chegada.
 */
function compareEvents(a: StatusInput, b: StatusInput): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  const byRank = rank(a.status) - rank(b.status);
  if (byRank !== 0) return byRank;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function rank(status: NormalizedStatus | null): number {
  if (status === null) return 0;
  return status === "excecao" ? 5 : PROGRESS[status];
}

/**
 * Status atual a partir do histórico inteiro, em qualquer ordem de chegada:
 * 1. qualquer `entregue` encerra;
 * 2. se o evento reconhecido mais recente for exceção, vale a exceção;
 * 3. senão, o maior progresso já visto. Evento antigo não faz o status voltar.
 * Eventos com status desconhecido (null) não participam.
 */
export function currentStatus(events: readonly StatusInput[]): NormalizedStatus | null {
  const known = events.filter((e) => e.status !== null);
  if (known.length === 0) return null;
  if (known.some((e) => e.status === "entregue")) return "entregue";

  const latest = known.reduce((a, b) => (compareEvents(a, b) >= 0 ? a : b));
  if (latest.status === "excecao") return "excecao";

  let best: NormalizedStatus | null = null;
  for (const e of known) {
    if (e.status === "excecao") continue;
    if (best === null || rank(e.status) > rank(best)) best = e.status;
  }
  return best;
}
