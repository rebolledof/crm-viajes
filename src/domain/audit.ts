import { LOSS_REASON_LABELS } from "./pipeline";

/** Textos de la pantalla de Auditoría: qué se hizo y con qué datos, en lenguaje de la agencia. */
export const AUDIT_ACTIONS: Record<string, string> = {
  "agency.created": "Creó la agencia",
  "agency.renamed": "Cambió el nombre de la agencia",
  "invitation.created": "Creó una invitación",
  "invitation.revoked": "Revocó una invitación",
  "invitation.accepted": "Aceptó una invitación",
  "membership.role_changed": "Cambió el rol de un miembro",
  "membership.revoked": "Quitó el acceso a un miembro",
  "contact.created": "Creó un contacto",
  "contact.updated": "Editó un contacto",
  "consent.recorded": "Registró un permiso de contacto",
  "whatsapp.opened": "Abrió WhatsApp con un contacto",
  "opportunity.created": "Creó una oportunidad",
  "opportunity.updated": "Editó una oportunidad",
  "opportunity.stage_changed": "Cambió la etapa de una oportunidad",
  "stage.created": "Creó una etapa del embudo",
  "stage.updated": "Cambió una etapa del embudo",
  "stage.reordered": "Reordenó las etapas del embudo",
  "task.created": "Creó una tarea",
  "task.completed": "Completó una tarea",
  "task.cancelled": "Canceló una tarea",
};

const LABELS: Record<string, string> = {
  name: "Nombre", fullName: "Nombre", kind: "Tipo", stage: "Etapa", destination: "Destino", title: "Tarea",
  result: "Resultado", motivo: "Motivo", nota: "Nota", evidencia: "Evidencia", phone: "Teléfono", channel: "Canal",
  purpose: "Uso", status: "Estado", source: "Cómo lo dio", active: "Activa", role: "Rol", email: "Correo",
  travelers: "Viajeros", travelStart: "Ida", travelEnd: "Regreso", budgetAmount: "Presupuesto", budgetCurrency: "Moneda",
};

function show(v: unknown): string {
  if (v === true) return "sí";
  if (v === false) return "no";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Detalle legible; omite identificadores internos y valores vacíos. */
export function auditDetail(action: string, changes: Record<string, unknown>, reason?: string | null): string {
  const parts: string[] = [];
  const rest = { ...changes };
  if (action === "opportunity.stage_changed" && "de" in rest && "a" in rest) {
    parts.push(`De ${show(rest.de)} a ${show(rest.a)}`);
    delete rest.de;
    delete rest.a;
  }
  for (const [k, v] of Object.entries(rest)) {
    if (v == null || v === "" || /Id$|^order$/.test(k)) continue;
    const value = k === "motivo" && typeof v === "string" && v in LOSS_REASON_LABELS ? LOSS_REASON_LABELS[v as keyof typeof LOSS_REASON_LABELS] : show(v);
    parts.push(`${LABELS[k] ?? k}: ${value}`);
  }
  if (reason) parts.push(`Razón: ${reason}`);
  return parts.join(" · ");
}
