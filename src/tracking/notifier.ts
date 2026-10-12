import { jsonLogger, type Logger } from "../log.ts";

export type DelayNotification = {
  kind: "atraso_aberto" | "atraso_desfeito";
  shipment_id: string;
  tracking_code: string;
  carrier: string;
  reference: string | null;
  limit_days: number;
  late_since: string;
  elapsed_days: number | null;
  message: string;
};

/** Para onde vão os avisos de atraso. O padrão grava no log; e-mail ou fila entram aqui. */
export interface Notifier {
  notify(notification: DelayNotification): void;
}

export function logNotifier(log: Logger = jsonLogger): Notifier {
  return { notify: (n) => log({ event: "aviso_atraso", ...n }) };
}
