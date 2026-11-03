// SPEC-003 · Bandeja unificada: reglas puras (estados, siguiente paso, respuestas guardadas y
// validación del formulario web) para que las pantallas solo pinten y las pruebas cubran las reglas.
import { normalizeEmail } from "./invitations";
import { normalizePhone } from "./phone";
import type { Role } from "./permissions";

export type InboundKind = "formulario" | "chat" | "correo";
export type ConversationStatus = "abierta" | "pendiente" | "resuelta";
export type MessageVia = "formulario" | "chat" | "correo" | "whatsapp";
export type InboxFilter = "sin_responder" | "mias" | "sin_asignar" | "todas" | "resueltas";

export const INBOX_FILTERS: { key: InboxFilter; label: string }[] = [
  { key: "sin_responder", label: "Sin responder" },
  { key: "mias", label: "Mías" },
  { key: "sin_asignar", label: "Sin asignar" },
  { key: "todas", label: "Todas" },
  { key: "resueltas", label: "Resueltas" },
];

export function isInboxFilter(v: unknown): v is InboxFilter {
  return typeof v === "string" && INBOX_FILTERS.some((f) => f.key === v);
}

export const CHANNEL_LABELS: Record<InboundKind, string> = { formulario: "Formulario web", chat: "Chat web", correo: "Correo" };
export const VIA_LABELS: Record<MessageVia, string> = { formulario: "Formulario web", chat: "Chat web", correo: "Correo", whatsapp: "WhatsApp" };
export const STATUS_LABELS: Record<ConversationStatus, string> = { abierta: "Abierta", pendiente: "Pendiente", resuelta: "Resuelta" };

/** Sin responder (RF-265): abierta y vencido el plazo calculado en horario laboral. */
export function isUnanswered(c: { status: ConversationStatus; replyDueAt: Date | null }, now: Date): boolean {
  return c.status === "abierta" && c.replyDueAt !== null && c.replyDueAt.getTime() < now.getTime();
}

export type ConversationStep = "tomar" | "responder" | "esperando" | "crear_oportunidad" | "resuelta";

export const STEP_LABELS: Record<ConversationStep, string> = {
  tomar: "Tomar",
  responder: "Responder",
  esperando: "Esperando al cliente",
  crear_oportunidad: "Crear oportunidad",
  resuelta: "Resuelta",
};

/**
 * Siguiente paso de una conversación (alcance 12): primero tener responsable, luego responder,
 * luego que tenga oportunidad; si ya respondimos, toca esperar al cliente.
 */
export function conversationStep(c: { status: ConversationStatus; assigneeId: string | null; opportunityId: string | null }): ConversationStep {
  if (c.status === "resuelta") return "resuelta";
  if (!c.assigneeId) return "tomar";
  if (c.status === "abierta") return "responder";
  if (!c.opportunityId) return "crear_oportunidad";
  return "esperando";
}

export type GuideStep = { key: "responde" | "oportunidad" | "siguiente"; title: string; detail: string; state: "hecho" | "actual" | "pendiente" };

/** "Qué hacer ahora" en la conversación: 1 Responde, 2 Vincula o crea la oportunidad, 3 Siguiente paso. */
export function conversationGuide(c: { status: ConversationStatus; assigneeId: string | null; opportunityId: string | null; openTasks: number }, me: string): GuideStep[] {
  const replied = c.status !== "abierta";
  const hasOpp = !!c.opportunityId;
  const hasNext = c.openTasks > 0;
  const responde = !c.assigneeId
    ? "Nadie la atiende todavía. Tómala y responde."
    : c.assigneeId !== me && !replied
      ? "La atiende otra persona del equipo."
      : replied
        ? "Ya le respondiste."
        : "El cliente espera tu respuesta. Usa una respuesta guardada para ir más rápido.";
  const steps: Omit<GuideStep, "state">[] = [
    { key: "responde", title: "Responde", detail: responde },
    { key: "oportunidad", title: hasOpp ? "Oportunidad vinculada" : "Crea la oportunidad", detail: hasOpp ? "La consulta ya está en el embudo." : "Si es una consulta de viaje, créala para seguirla en el embudo." },
    { key: "siguiente", title: "Programa el siguiente paso", detail: hasNext ? `Tiene ${c.openTasks === 1 ? "1 tarea abierta" : `${c.openTasks} tareas abiertas`}.` : "Agrega una tarea con fecha para no perder el hilo." },
  ];
  const done = [replied, hasOpp, hasNext];
  const at = done.findIndex((d) => !d);
  return steps.map((s, i) => ({ ...s, state: done[i] ? "hecho" : i === at ? "actual" : "pendiente" }));
}

/** "hace 42 min", "hace 3 h", "hace 2 días". */
export function waitLabel(from: Date, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** Reemplaza {nombre}, {asesor} y {agencia} de una respuesta guardada (RF-269). */
export function fillSavedReply(body: string, v: { nombre: string; asesor: string; agencia: string }): string {
  const first = (s: string) => s.trim().split(/\s+/)[0] ?? "";
  return body.replaceAll("{nombre}", first(v.nombre)).replaceAll("{asesor}", first(v.asesor)).replaceAll("{agencia}", v.agencia.trim());
}

/** Nombre corto de una persona del equipo a partir de su correo: "ana.perez@x" → "Ana". */
export function displayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const word = local.split(/[._\-+0-9]+/).find(Boolean) ?? local;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Atajo que se está escribiendo: "/sal" → "sal"; null si la caja no empieza por "/". */
export function typedShortcut(text: string): string | null {
  const m = /^\/([a-z0-9_-]*)$/i.exec(text.trim());
  return m ? m[1].toLowerCase() : null;
}

export function matchReplies<T extends { shortcut: string; title: string }>(replies: T[], query: string): T[] {
  const q = query.toLowerCase();
  return replies.filter((r) => r.shortcut.startsWith(q) || r.title.toLowerCase().includes(q));
}

export function normalizeShortcut(raw: string): string | null {
  const s = raw.trim().replace(/^\//, "").toLowerCase();
  return /^[a-z0-9_-]{1,30}$/.test(s) ? s : null;
}

export const MAX_MESSAGE = 4000;

export type WebFormInput = { name: string; phone: string; email: string; destination: string; dates: string; travelers: string; message: string; privacy: boolean };
export type WebFormData = { name: string; phone: string | null; email: string | null; destination: string | null; dates: string | null; travelers: number | null; message: string | null };
export type WebFormError = { field: keyof WebFormInput | "contacto"; message: string };

/** Valida el formulario público (RF-261, RF-271). El mensaje va en palabras del visitante. */
export function parseWebForm(input: WebFormInput): { ok: true; data: WebFormData } | { ok: false; error: WebFormError } {
  const name = input.name.trim();
  if (!name || name.length > 160) return { ok: false, error: { field: "name", message: "Escribe tu nombre." } };
  let phone: string | null = null;
  if (input.phone.trim()) {
    phone = normalizePhone(input.phone);
    if (!phone) return { ok: false, error: { field: "phone", message: "Revisa el teléfono. Si no es de Colombia, escríbelo con el indicativo, por ejemplo +34 600 000 000." } };
  }
  let email: string | null = null;
  if (input.email.trim()) {
    email = normalizeEmail(input.email);
    if (!/^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(email) || email.length > 254) return { ok: false, error: { field: "email", message: "Revisa el correo, por ejemplo nombre@correo.com." } };
  }
  if (!phone && !email) return { ok: false, error: { field: "phone", message: "Déjanos un teléfono o un correo para responderte." } };
  const destination = input.destination.trim() || null;
  if (destination && destination.length > 160) return { ok: false, error: { field: "destination", message: "El destino es muy largo (máximo 160 letras)." } };
  const dates = input.dates.trim() || null;
  if (dates && dates.length > 200) return { ok: false, error: { field: "dates", message: "Las fechas son muy largas (máximo 200 letras)." } };
  let travelers: number | null = null;
  if (input.travelers.trim()) {
    travelers = Number(input.travelers);
    if (!Number.isInteger(travelers) || travelers < 1 || travelers > 999) return { ok: false, error: { field: "travelers", message: "Los viajeros van como número, de 1 a 999." } };
  }
  const message = input.message.trim() || null;
  if (message && message.length > MAX_MESSAGE) return { ok: false, error: { field: "message", message: `El mensaje es muy largo (máximo ${MAX_MESSAGE} letras).` } };
  if (!input.privacy) return { ok: false, error: { field: "privacy", message: "Para enviar, acepta el aviso de privacidad. Lo que escribiste se conserva." } };
  return { ok: true, data: { name, phone, email, destination, dates, travelers, message } };
}

/** Quién puede hacer qué en una conversación. La base aplica lo mismo (RLS y trigger). */
export function conversationActions(role: Role, me: string, c: { assigneeId: string | null; status: ConversationStatus }) {
  const write = role === "admin" || role === "asesor";
  return {
    reply: write,
    take: write && !c.assigneeId,
    reassign: role === "admin",
    resolve: write && c.status !== "resuelta",
    mine: c.assigneeId === me,
  };
}

/** Código para pegar en la web de la agencia: el formulario dentro de un marco. */
export function embedSnippet(formUrl: string): string {
  return `<iframe src="${formUrl}?embed=1" title="Pide tu cotización" style="width:100%;max-width:640px;height:860px;border:0" loading="lazy"></iframe>`;
}
