// SPEC-002c · Guía paso a paso: el plan del día, el camino de etapas y el siguiente paso.
// Funciones puras para que las pantallas solo pinten y las pruebas cubran las reglas.
import type { StageKind } from "./pipeline";
import { dueState, type TaskKind } from "./tasks";

export type PlanStepState = "hecho" | "actual" | "pendiente";
export type PlanStep = { key: "mensajes" | "vencidas" | "hoy" | "sin_paso" | "listo"; title: string; detail: string; count: number; state: PlanStepState };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "Tu plan de hoy" (RF-245): primero lo vencido, luego lo de hoy, después dar siguiente paso a las
 * oportunidades sin plan. El paso actual es el primero con algo pendiente.
 */
export function dayPlan(counts: { overdue: number; today: number; withoutNext: number; unanswered?: number }): PlanStep[] {
  // SPEC-003: con la bandeja, responder los mensajes sin respuesta va primero (alcance 12).
  const messages: Omit<PlanStep, "state">[] =
    counts.unanswered === undefined
      ? []
      : [{ key: "mensajes", title: "Responde los mensajes", detail: counts.unanswered ? `${plural(counts.unanswered, "sin responder", "sin responder")}` : "Nada sin responder", count: counts.unanswered }];
  const steps: Omit<PlanStep, "state">[] = [
    ...messages,
    { key: "vencidas", title: "Atender vencidas", detail: counts.overdue ? `${plural(counts.overdue, "pendiente", "pendientes")}` : "Nada vencido", count: counts.overdue },
    { key: "hoy", title: "Tareas de hoy", detail: counts.today ? `${plural(counts.today, "pendiente", "pendientes")}` : "Nada para hoy", count: counts.today },
    { key: "sin_paso", title: "Dar siguiente paso", detail: counts.withoutNext ? `${plural(counts.withoutNext, "oportunidad sin plan", "oportunidades sin plan")}` : "Todas tienen plan", count: counts.withoutNext },
    { key: "listo", title: "¡Día al día!", detail: "Todo con siguiente paso", count: 0 },
  ];
  const current = steps.findIndex((s) => s.key !== "listo" && s.count > 0);
  const at = current === -1 ? steps.length - 1 : current;
  return steps.map((s, i) => ({ ...s, state: i < at ? "hecho" : i === at ? "actual" : "pendiente" }));
}

export type PathStage = { id: string; name: string; kind: StageKind };
export type PathItem = { id: string; name: string; state: PlanStepState; closed?: "ganada" | "perdida" };

/**
 * Camino de etapas de una oportunidad (RF-246): las etapas abiertas activas en su orden y al final
 * el cierre. Una oportunidad cerrada marca todas las abiertas como hechas y el cierre como actual.
 */
export function stagePath(stages: PathStage[], current: { stageId: string; kind: StageKind }): PathItem[] {
  const open = stages.filter((s) => s.kind === "abierta");
  const idx = open.findIndex((s) => s.id === current.stageId);
  const closed = current.kind !== "abierta";
  const closedStage = closed ? stages.find((s) => s.id === current.stageId) : undefined;
  const items: PathItem[] = open.map((s, i) => ({
    id: s.id,
    name: s.name,
    state: closed ? "hecho" : idx === -1 ? "pendiente" : i < idx ? "hecho" : i === idx ? "actual" : "pendiente",
  }));
  items.push({
    id: "cierre",
    name: closed ? (closedStage?.name ?? (current.kind === "ganada" ? "Ganado" : "Perdido")) : "Cerrar",
    state: closed ? "actual" : "pendiente",
    closed: closed ? (current.kind as "ganada" | "perdida") : undefined,
  });
  return items;
}

export type NextStepStatus = "vencida" | "hoy" | "programada" | "sin_paso" | "sin_oportunidad";

/** Estado del siguiente paso de un contacto en la lista (alcance 5 de SPEC-002c). */
export function nextStepStatus(next: { dueAt: Date | null; openOpportunities: number }, now: Date): NextStepStatus {
  if (next.dueAt) {
    const s = dueState(next.dueAt, now);
    return s === "vencida" ? "vencida" : s === "hoy" ? "hoy" : "programada";
  }
  return next.openOpportunities > 0 ? "sin_paso" : "sin_oportunidad";
}

/** Verbo del botón principal de una tarea según su tipo. */
export const TASK_ACTION_LABELS: Record<TaskKind, string> = {
  llamada: "Llamar",
  whatsapp: "WhatsApp",
  correo: "Escribir",
  reunion: "Reunión",
  seguimiento: "Hacer seguimiento",
  recordatorio: "Ver recordatorio",
  tarea: "Hacer tarea",
};
