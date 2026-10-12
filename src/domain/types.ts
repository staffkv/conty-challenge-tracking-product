export const NORMALIZED_STATUSES = ["postado", "em_transito", "saiu_para_entrega", "entregue", "excecao"] as const;

export type NormalizedStatus = (typeof NORMALIZED_STATUSES)[number];

/** Evento de rastreio no formato do domínio. Nenhum campo depende do agregador. */
export type TrackingEvent = {
  /** Instante em UTC, com precisão de segundos; o adaptador resolve o fuso. */
  occurredAt: Date;
  /** null quando a transportadora mandou um status que não conhecemos. */
  status: NormalizedStatus | null;
  /** Código original da transportadora, guardado só para auditoria e exibição. */
  rawStatus: string;
  description: string;
  location: string | null;
};

export type ProviderErrorKind = "nao_encontrado" | "indisponivel" | "resposta_invalida" | "rejeitado";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

/** O que o resto do código sabe sobre um agregador de rastreio. */
export interface TrackingProvider {
  readonly name: string;
  supportsCarrier(carrier: string): boolean;
  register(trackingCode: string, carrier: string): Promise<void>;
  fetchEvents(trackingCode: string, carrier: string): Promise<TrackingEvent[]>;
}
