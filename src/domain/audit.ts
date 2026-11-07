// Auditoría en lenguaje de la agencia (informe de QA, 2 nov 2026): cada evento se describe con una
// frase ("Activó la etapa «Nuevo»") y detalles legibles, en vez de la clave técnica y el JSON.
// Función pura: los nombres de etapas, contactos, tareas y plantillas los busca el servidor.
import { EDIT_LEVEL_SHORT, describeDelay, TRIGGER_LABELS, isDelayUnit, isEditLevel, isFollowupTrigger } from "./followups";
import { ROLE_LABELS, type Role } from "./permissions";
import { LOSS_REASON_LABELS, STAGE_KIND_LABELS, isLossReason, type StageKind } from "./pipeline";
import { formatPhone } from "./phone";
import { isCurrency, type Currency } from "./money";
import { formatAmount, formatQuoteNumber } from "./quotes";
import { PRIORITY_LABELS, TASK_KIND_LABELS, isPriority, isTaskKind } from "./tasks";

export type AuditEventLike = {
  action: string;
  objectType: string;
  objectId: string | null;
  changes: Record<string, unknown>;
  reason?: string | null;
};

/** Nombre visible de cada objeto por id; undefined si ya no existe o no se encontró. */
export type AuditNames = {
  member?: (id: string) => string | undefined;
  stage?: (id: string) => string | undefined;
  contact?: (id: string) => string | undefined;
  opportunity?: (id: string) => string | undefined;
  task?: (id: string) => string | undefined;
  template?: (id: string) => string | undefined;
};

export type AuditDescription = { text: string; details: string[] };

const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp", correo: "correo", telefono: "llamadas" };
const PURPOSE_LABELS: Record<string, string> = { servicio: "atención del viaje", promociones: "promociones" };

const fecha = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const q = (name: string | undefined, fallback: string) => (name ? `«${name}»` : fallback);
const hhmm = (v: unknown) => str(v)?.slice(0, 5);
const role = (v: unknown) => (typeof v === "string" && v in ROLE_LABELS ? ROLE_LABELS[v as Role] : str(v) ?? "");

function when(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : fecha.format(d);
}

function day(v: unknown): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v) ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : str(v);
}

/** Lo que se ve como "Etiqueta: valor", solo para los valores presentes. */
function lines(pairs: [string, string | undefined | null | false][]): string[] {
  return pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
}

function stepDetails(c: Record<string, unknown>): string[] {
  return lines([
    ["Tipo", isTaskKind(c.kind) ? TASK_KIND_LABELS[c.kind] : undefined],
    ["Cuándo", typeof c.delayAmount === "number" && isDelayUnit(c.delayUnit) ? describeDelay(c.delayAmount, c.delayUnit, str(c.atTime)) : undefined],
    ["Prioridad", isPriority(c.priority) ? PRIORITY_LABELS[c.priority] : undefined],
    ["Mensaje", str(c.message)],
    ["Bloqueada para asesores", c.locked === true ? "sí" : undefined],
  ]);
}

export function describeAudit(e: AuditEventLike, n: AuditNames = {}): AuditDescription {
  const c = e.changes ?? {};
  const id = e.objectId ?? "";
  const reason = str(e.reason);
  const member = (v: unknown) => (typeof v === "string" ? (n.member?.(v) ?? "una persona que ya no está en la agencia") : undefined);
  // "la etapa «Nuevo»" o, si ya no existe, "una etapa".
  const ref = (art: string, noun: string, name: string | undefined) => (name ? `${art} ${noun} «${name}»` : `${art === "la" ? "una" : "un"} ${noun}`);
  const stage = ref("la", "etapa", n.stage?.(id));
  const contact = ref("el", "contacto", n.contact?.(id));
  const person = n.contact?.(id) ? `«${n.contact(id)}»` : "un contacto";
  const opp = ref("la", "oportunidad", n.opportunity?.(id));
  const task = ref("la", "tarea", n.task?.(id));
  const template = ref("la", "plantilla", n.template?.(id));

  switch (e.action) {
    case "agency.created":
      return { text: `Creó la agencia ${q(str(c.name), "")}`.trim(), details: [] };
    case "agency.renamed":
      return { text: `Cambió el nombre de la agencia a ${q(str(c.name), "uno nuevo")}`, details: [] };
    case "invitation.created":
      return { text: `Invitó a ${str(c.email) ?? "una persona"} como ${role(c.role)}`, details: [] };
    case "invitation.revoked":
      return { text: "Revocó una invitación pendiente", details: [] };
    case "invitation.accepted":
      return { text: `Aceptó la invitación y entró como ${role(c.role)}`, details: [] };
    case "membership.role_changed":
      return { text: `Cambió el rol de ${member(id)} a ${role(c.role)}`, details: [] };
    case "membership.revoked":
      return { text: `Quitó el acceso a ${member(id)}`, details: [] };

    case "stage.created": {
      const kind = typeof c.kind === "string" && c.kind !== "abierta" && c.kind in STAGE_KIND_LABELS ? STAGE_KIND_LABELS[c.kind as StageKind] : undefined;
      return { text: `Creó la etapa ${q(str(c.name), "nueva")}`, details: lines([["Tipo", kind]]) };
    }
    case "stage.updated": {
      const parts: string[] = [];
      if (str(c.name)) parts.push(`Renombró la etapa a «${str(c.name)}»`);
      if (c.active === true) parts.push(parts.length ? "y la activó" : `Activó ${stage}`);
      if (c.active === false) parts.push(parts.length ? "y la desactivó" : `Desactivó ${stage}`);
      if ("goal" in c) parts.push(parts.length ? (str(c.goal) ? "y cambió su meta" : "y quitó su meta") : str(c.goal) ? `Cambió la meta de ${stage}` : `Quitó la meta de ${stage}`);
      return { text: parts.join(" ") || `Editó ${stage}`, details: lines([["Meta", str(c.goal)]]) };
    }
    case "branding.updated": {
      const color = (v: unknown) => {
        const x = v as { de?: unknown; a?: unknown } | undefined;
        return x && str(x.a) ? `${str(x.de) ?? "de fábrica"} → ${str(x.a)}` : undefined;
      };
      return {
        text: "Cambió la marca de la agencia",
        details: lines([
          ["Color principal", color(c.primaryColor)],
          ["Color de acento", color(c.accentColor)],
          ["Logo", c.logo === "cambiado" ? "subió uno nuevo" : c.logo === "quitado" ? "lo quitó" : undefined],
        ]),
      };
    }
    // SPEC-003 · Bandeja.
    case "conversation.assigned":
      return { text: c.to ? `Asignó una conversación de la bandeja a ${member(c.to)}` : "Devolvió una conversación de la bandeja a Sin asignar", details: [] };
    case "saved_reply.created":
      return { text: `Creó la respuesta guardada /${str(c.shortcut) ?? ""}`, details: [] };
    case "saved_reply.updated":
      return { text: `Editó la respuesta guardada /${str(c.shortcut) ?? ""}`, details: [] };
    case "saved_reply.deleted":
      return { text: `Borró la respuesta guardada /${str(c.shortcut) ?? ""}`, details: [] };
    case "inbox.settings": {
      const pair = (v: unknown, fmt: (x: unknown) => string | undefined) => {
        const x = v as { from?: unknown; to?: unknown } | undefined;
        return x && JSON.stringify(x.from) !== JSON.stringify(x.to) ? `${fmt(x.from) ?? "sin definir"} → ${fmt(x.to) ?? "sin definir"}` : undefined;
      };
      const mins = (x: unknown) => (typeof x === "number" ? `${x} min` : undefined);
      const onOff = (x: unknown) => (x === true ? "recibe mensajes" : x === false ? "pausado" : undefined);
      return {
        text: "Cambió los canales de entrada de la bandeja",
        details: lines([
          ["Tiempo máximo sin respuesta", pair(c.maxMinutes, mins)],
          ["Aviso de privacidad", pair(c.privacyUrl, str)],
          ["Formulario web", pair(c.formActive, onOff)],
        ]),
      };
    }
    case "stage.reordered":
      return { text: "Cambió el orden de las etapas del embudo", details: [] };

    case "contact.created":
      return { text: `Creó el contacto ${q(str(c.fullName), "nuevo")}`, details: [] };
    case "contact.updated":
      return { text: `Editó ${str(c.fullName) ? `el contacto «${str(c.fullName)}»` : contact}`, details: lines([["Responsable", c.ownerId ? member(c.ownerId) : "sin responsable"]]) };
    case "consent.recorded": {
      const verb = c.status === "retirado" ? "Retiró" : "Registró";
      const channel = CHANNEL_LABELS[String(c.channel)] ?? String(c.channel ?? "");
      const purpose = PURPOSE_LABELS[String(c.purpose)] ?? String(c.purpose ?? "");
      return { text: `${verb} el permiso de ${channel} para ${purpose} de ${person}`, details: lines([["Fuente", str(c.source)]]) };
    }
    case "whatsapp.opened":
      return { text: `Abrió WhatsApp para escribir a ${person}`, details: lines([["Teléfono", str(c.phone) ? formatPhone(String(c.phone)) : undefined]]) };

    case "opportunity.created":
      return {
        text: `Creó una oportunidad para ${q(c.contactId ? n.contact?.(String(c.contactId)) : undefined, "un contacto")}`,
        details: lines([["Destino", str(c.destination) ?? "sin destino"], ["Etapa", str(c.stage)]]),
      };
    case "opportunity.updated":
      return {
        text: `Editó los datos de ${opp}`,
        details: lines([
          ["Destino", str(c.destination)],
          ["Producto", str(c.product)],
          ["Fecha del viaje", [day(c.travelStart), day(c.travelEnd)].filter(Boolean).join(" al ") || undefined],
          ["Viajeros", typeof c.travelers === "number" ? String(c.travelers) : undefined],
          ["Presupuesto", str(c.budgetAmount) ? `${c.budgetAmount} ${str(c.budgetCurrency) ?? ""}`.trim() : undefined],
          ["Prioridad", isPriority(c.priority) ? PRIORITY_LABELS[c.priority] : undefined],
          ["Responsable", c.ownerId ? member(c.ownerId) : undefined],
        ]),
      };
    case "opportunity.stage_changed":
      return {
        text: `Movió ${opp} de «${str(c.de) ?? "?"}» a «${str(c.a) ?? "?"}»`,
        details: lines([
          ["Motivo de pérdida", isLossReason(c.motivo) ? LOSS_REASON_LABELS[c.motivo] : str(c.motivo)],
          ["Nota", str(c.nota)],
          ["Evidencia del cierre", str(c.evidencia)],
          ["Razón", reason],
        ]),
      };

    case "task.created":
      return { text: `Creó ${str(c.title) ? `la tarea «${str(c.title)}»` : task}`, details: lines([["Asignada a", c.assigneeId ? member(c.assigneeId) : undefined]]) };
    case "task.completed":
      return { text: `Completó ${task}`, details: lines([["Resultado", str(c.result)]]) };
    case "task.cancelled":
      return { text: `Canceló ${task}`, details: lines([["Motivo", reason]]) };
    case "task.updated":
      return {
        text: `Ajustó ${task}`,
        details: lines([
          ["Nueva fecha", when(c.vence)],
          ["Prioridad", isPriority(c.prioridad) ? PRIORITY_LABELS[c.prioridad] : undefined],
          ["Mensaje", "mensaje" in c ? (str(c.mensaje) ?? "sin mensaje") : undefined],
          ["Asignada a", c.asignada ? member(c.asignada) : undefined],
        ]),
      };

    case "followup.applied":
      return {
        text: `Se aplicó la plantilla ${q(c.template ? n.template?.(String(c.template)) : undefined, "de seguimiento")} a ${opp}`,
        details: lines([["Tareas creadas", typeof c.tasks === "number" ? String(c.tasks) : undefined]]),
      };
    case "followup.template_created":
    case "followup.template_updated": {
      const created = e.action === "followup.template_created";
      const name = q(str(c.name) ?? n.template?.(id), "de seguimiento");
      const keys = Object.keys(c);
      if (!created && keys.length === 1 && typeof c.active === "boolean") {
        return { text: `${c.active ? "Activó" : "Desactivó"} la plantilla ${name}`, details: [] };
      }
      return {
        text: `${created ? "Creó" : "Editó"} la plantilla${created && c.ownerId ? " personal" : ""} ${name}`,
        details: lines([
          ["Se activa cuando", isFollowupTrigger(c.trigger) ? TRIGGER_LABELS[c.trigger] : undefined],
          ["Etapa", c.stageId ? n.stage?.(String(c.stageId)) : undefined],
          ["Se detiene en", c.stopStageId ? n.stage?.(String(c.stopStageId)) : undefined],
          ["Edición por asesores", isEditLevel(c.editLevel) ? EDIT_LEVEL_SHORT[c.editLevel] : undefined],
          ["Estado", typeof c.active === "boolean" ? (c.active ? "activa" : "inactiva") : undefined],
        ]),
      };
    }
    case "followup.step_created":
      return { text: `Agregó el paso ${q(str(c.title), "nuevo")} a ${template}`, details: stepDetails(c) };
    case "followup.step_updated":
      return { text: `Editó ${str(c.title) ? `el paso «${str(c.title)}»` : "un paso"} de ${template}`, details: stepDetails(c) };
    case "followup.step_deleted":
      return { text: `Borró ${str(c.title) ? `el paso «${str(c.title)}»` : "un paso"} de ${template}`, details: [] };

    case "quote.created":
      return { text: `Creó la cotización N.º ${typeof c.numero === "number" ? formatQuoteNumber(c.numero) : "nueva"}`, details: lines([["Oportunidad", c.oportunidad ? n.opportunity?.(String(c.oportunidad)) : undefined]]) };
    case "quote.version_created":
      return {
        text: `Creó la versión ${typeof c.version === "number" ? c.version : "nueva"} de una cotización`,
        details: lines([["A partir de la versión", typeof c.desde === "number" ? String(c.desde) : undefined]]),
      };

    case "quote.sent":
      return {
        text: `Envió la versión ${typeof c.version === "number" ? c.version : ""} de la cotización N.º ${typeof c.numero === "number" ? formatQuoteNumber(c.numero) : ""}`.replace(/\s+/g, " "),
        details: lines([
          ["Total", c.total != null && isCurrency(String(c.moneda)) ? formatAmount(String(c.total), String(c.moneda) as Currency) : undefined],
          ["La oportunidad pasó a", str(c.etapa)],
        ]),
      };
    case "quote.accepted":
    case "quote.rejected":
      return {
        text: `Marcó ${e.action === "quote.accepted" ? "aceptada" : "rechazada"} la versión ${typeof c.version === "number" ? c.version : ""} de la cotización N.º ${typeof c.numero === "number" ? formatQuoteNumber(c.numero) : ""}`.replace(/\s+/g, " "),
        details: [],
      };

    case "catalog.created":
      return { text: `Agregó «${str(c.description) ?? "un servicio"}» al catálogo`, details: [] };
    case "catalog.updated":
      return { text: `Cambió «${str(c.description) ?? "un servicio"}» del catálogo`, details: lines([["Estado", typeof c.active === "boolean" ? (c.active ? "activo" : "desactivado") : undefined]]) };
    case "quote_settings.updated":
      return {
        text: "Cambió los ajustes de las cotizaciones",
        details: lines([
          ["Margen mínimo de aviso", c.minMarginPct != null ? `${String(c.minMarginPct).replace(".", ",")} %` : undefined],
          ["Vigencia por defecto", typeof c.validityDays === "number" ? `${c.validityDays} días` : undefined],
        ]),
      };

    case "settings.updated":
      return {
        text: "Cambió el horario laboral y las reglas de seguimiento",
        details: lines([
          ["Lunes a viernes", hhmm(c.weekdayStart) && hhmm(c.weekdayEnd) ? `${hhmm(c.weekdayStart)} a ${hhmm(c.weekdayEnd)}` : undefined],
          ["Sábados", hhmm(c.saturdayStart) && hhmm(c.saturdayEnd) ? `${hhmm(c.saturdayStart)} a ${hhmm(c.saturdayEnd)}` : "sin atención"],
          ["Plantillas propias de asesores", typeof c.allowPersonalTemplates === "boolean" ? (c.allowPersonalTemplates ? "permitidas" : "no permitidas") : undefined],
        ]),
      };
  }
  // Acción nueva sin texto todavía: se muestra legible en lo posible, nunca como JSON.
  const details = Object.entries(c)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => `${k}: ${v === true ? "sí" : v === false ? "no" : v}`);
  return { text: `Acción registrada (${e.action})`, details: reason ? [...details, `Motivo: ${reason}`] : details };
}
