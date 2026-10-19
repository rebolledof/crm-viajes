/** Tareas y "Mi día" (SPEC-002 RF-210, RF-211). */
export const TASK_KINDS = ["llamada", "seguimiento", "recordatorio", "correo", "reunion", "tarea"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  llamada: "Llamada",
  seguimiento: "Seguimiento",
  recordatorio: "Recordatorio",
  correo: "Correo",
  reunion: "Reunión",
  tarea: "Tarea",
};

export const PRIORITIES = ["baja", "media", "alta"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { baja: "Baja", media: "Media", alta: "Alta" };

export function isTaskKind(v: unknown): v is TaskKind {
  return typeof v === "string" && (TASK_KINDS as readonly string[]).includes(v);
}
export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
}

/** Zona horaria de la agencia piloto; "hoy" se calcula en ella, no en la del servidor. */
export const AGENCY_TIME_ZONE = "America/Bogota";

/** Fin del día local (excluyente) para la zona horaria dada. Colombia no tiene horario de verano. */
export function endOfLocalDay(now: Date, timeZone = AGENCY_TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const localMidnightUtc = Date.UTC(get("year"), get("month") - 1, get("day") + 1);
  const offsetMs = tzOffsetMs(new Date(localMidnightUtc), timeZone);
  return new Date(localMidnightUtc - offsetMs);
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}

export type DueState = "vencida" | "hoy" | "proxima";

export function dueState(dueAt: Date, now: Date, timeZone = AGENCY_TIME_ZONE): DueState {
  if (dueAt.getTime() < now.getTime()) return "vencida";
  if (dueAt.getTime() < endOfLocalDay(now, timeZone).getTime()) return "hoy";
  return "proxima";
}

/** Convierte el valor de un <input type="datetime-local"> (hora de Colombia, UTC-5 fijo) a Date. */
export function parseBogotaDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Valor para un <input type="datetime-local"> en hora de Colombia. */
export function toBogotaInput(d: Date): string {
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 16);
}
