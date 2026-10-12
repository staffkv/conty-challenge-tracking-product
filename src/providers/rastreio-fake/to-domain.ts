import type { TrackingEvent } from "../../domain/types.ts";
import { checkpointSchema, type RawCheckpoint } from "./payload.ts";
import { translateStatus } from "./status-map.ts";

/** Horário sem fuso é horário de Brasília (sem horário de verão desde 2019). */
export const DEFAULT_OFFSET = "-03:00";

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

/** Converte o horário do checkpoint para um instante UTC, em segundos. */
export function parseCheckpointTime(time: string, tz: string | null | undefined): Date | null {
  const t = time.trim();
  let iso: string;
  if (WITH_ZONE.test(t)) {
    iso = t;
  } else if (LOCAL_TIME.test(t)) {
    const offset = tz?.trim() || DEFAULT_OFFSET;
    if (!OFFSET.test(offset)) return null;
    iso = `${t.replace(" ", "T")}${t.length === 16 ? ":00" : ""}${offset}`;
  } else {
    return null;
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(Math.floor(ms / 1000) * 1000);
}

export function checkpointToEvent(carrier: string, cp: RawCheckpoint): TrackingEvent | null {
  const occurredAt = parseCheckpointTime(cp.checkpoint_time, cp.checkpoint_tz);
  if (occurredAt === null) return null;
  return {
    occurredAt,
    status: translateStatus(carrier, cp.courier_status),
    rawStatus: cp.courier_status,
    description: cp.message,
    location: cp.location?.trim() || null,
  };
}

export type ConversionResult = {
  events: TrackingEvent[];
  /** Checkpoints sem os campos obrigatórios ou com horário ilegível. */
  discarded: unknown[];
};

export function checkpointsToEvents(carrier: string, checkpoints: readonly unknown[]): ConversionResult {
  const events: TrackingEvent[] = [];
  const discarded: unknown[] = [];
  for (const raw of checkpoints) {
    const parsed = checkpointSchema.safeParse(raw);
    const event = parsed.success ? checkpointToEvent(carrier, parsed.data) : null;
    if (event) events.push(event);
    else discarded.push(raw);
  }
  return { events, discarded };
}
