import { createHash } from "node:crypto";
import type { TrackingEvent } from "./types.ts";

/**
 * Identidade do evento pelo conteúdo, não pelo id do agregador: o mesmo evento
 * reenviado com outro id continua sendo o mesmo evento.
 */
export function eventKey(carrier: string, event: TrackingEvent): string {
  const seconds = Math.floor(event.occurredAt.getTime() / 1000);
  const parts = [carrier, event.rawStatus, seconds, event.location ?? ""];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
