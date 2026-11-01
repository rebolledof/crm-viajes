/**
 * Plantillas de seguimiento (SPEC-002b). La base de datos crea y cancela las tareas; este módulo
 * da los textos de la interfaz, el permiso de edición por nivel y el relleno de mensajes.
 */
import type { Role } from "./permissions";

export const FOLLOWUP_TRIGGERS = ["creada", "etapa", "ganada", "perdida"] as const;
export type FollowupTrigger = (typeof FOLLOWUP_TRIGGERS)[number];
export const TRIGGER_LABELS: Record<FollowupTrigger, string> = {
  creada: "Se crea una oportunidad",
  etapa: "La oportunidad entra en una etapa",
  ganada: "La oportunidad se gana",
  perdida: "La oportunidad se pierde",
};

export const EDIT_LEVELS = ["bloqueada", "ajustable", "libre"] as const;
export type EditLevel = (typeof EDIT_LEVELS)[number];
export const EDIT_LEVEL_LABELS: Record<EditLevel, string> = {
  bloqueada: "Bloqueada: el asesor solo la completa",
  ajustable: "Ajustable: el asesor mueve la fecha, la prioridad y el mensaje",
  libre: "Libre: además reasigna y cancela",
};
export const EDIT_LEVEL_SHORT: Record<EditLevel, string> = { bloqueada: "Bloqueada", ajustable: "Ajustable", libre: "Libre" };

export const DELAY_UNITS = ["minutos", "horas_habiles", "dias_habiles", "dias"] as const;
export type DelayUnit = (typeof DELAY_UNITS)[number];
export const DELAY_UNIT_LABELS: Record<DelayUnit, string> = {
  minutos: "minutos",
  horas_habiles: "horas hábiles",
  dias_habiles: "días hábiles",
  dias: "días calendario",
};

const isOneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (list as readonly string[]).includes(v);
export const isFollowupTrigger = isOneOf(FOLLOWUP_TRIGGERS);
export const isEditLevel = isOneOf(EDIT_LEVELS);
export const isDelayUnit = isOneOf(DELAY_UNITS);

const SINGULAR: Record<DelayUnit, string> = { minutos: "minuto", horas_habiles: "hora hábil", dias_habiles: "día hábil", dias: "día calendario" };

/** "Al momento", "15 minutos después", "1 día hábil después, a las 10:00", "El mismo día hábil". */
export function describeDelay(amount: number, unit: DelayUnit, atTime?: string | null): string {
  const at = atTime ? `, a las ${atTime.slice(0, 5)}` : "";
  if (amount === 0) {
    if (unit === "dias_habiles") return `El mismo día hábil${at}`;
    if (unit === "dias") return `El mismo día${at}`;
    return "Al momento";
  }
  return `${amount} ${amount === 1 ? SINGULAR[unit] : DELAY_UNIT_LABELS[unit]} después${at}`;
}

export type TaskPermissions = { complete: boolean; adjust: boolean; reassign: boolean; cancel: boolean };

/**
 * Qué puede hacer cada rol con una tarea según su nivel (RF-226). Las tareas creadas a mano no
 * tienen nivel y se comportan como libres. El administrador puede todo; lectura, nada.
 */
export function taskPermissions(role: Role | null | undefined, level: EditLevel | null | undefined): TaskPermissions {
  if (role === "admin") return { complete: true, adjust: true, reassign: true, cancel: true };
  if (role !== "asesor") return { complete: false, adjust: false, reassign: false, cancel: false };
  const l = level ?? "libre";
  return { complete: true, adjust: l !== "bloqueada", reassign: l === "libre", cancel: l === "libre" };
}

/**
 * Rellena {nombre}, {agencia} y {destino}. Si el destino es desconocido quita la preposición que lo
 * precede ("a {destino}") para que la frase siga siendo natural.
 */
export function fillMessage(template: string, values: { nombre: string; agencia: string; destino?: string | null }): string {
  const firstName = values.nombre.trim().split(/\s+/)[0] ?? "";
  const destino = values.destino?.trim();
  let text = template.replaceAll("{nombre}", firstName).replaceAll("{agencia}", values.agencia.trim());
  text = destino ? text.replaceAll("{destino}", destino) : text.replace(/\s+(a|para|de|en)\s+\{destino\}/g, "").replaceAll("{destino}", "");
  return text.replace(/\s+([.,?!])/g, "$1").replace(/ {2,}/g, " ").trim();
}

/** Enlace mailto con asunto y cuerpo; lo abre el programa de correo del asesor. */
export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Valida "HH:MM" de un <input type="time">. */
export function parseTime(value: string): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}
