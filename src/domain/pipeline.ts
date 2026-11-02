/** Embudo por agencia (SPEC-002 RF-208, RF-209, RF-215 a RF-217). */
export const STAGE_KINDS = ["abierta", "ganada", "perdida"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  abierta: "Abierta",
  ganada: "Ganada",
  perdida: "Perdida",
};

export const LOSS_REASONS = ["precio", "sin_disponibilidad", "cambio_de_planes", "sin_respuesta", "competencia", "otro"] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  precio: "Precio",
  sin_disponibilidad: "Sin disponibilidad",
  cambio_de_planes: "Cambio de planes",
  sin_respuesta: "Sin respuesta del cliente",
  competencia: "Se fue con la competencia",
  otro: "Otro",
};

export function isStageKind(v: unknown): v is StageKind {
  return typeof v === "string" && (STAGE_KINDS as readonly string[]).includes(v);
}
export function isLossReason(v: unknown): v is LossReason {
  return typeof v === "string" && (LOSS_REASONS as readonly string[]).includes(v);
}

export type CloseInput = { lostReason?: LossReason | null; lostNote?: string | null; wonEvidence?: string | null };
export type CloseError = "lost_reason_required" | "lost_note_required" | "won_evidence_required";

/** Lo que exige pasar a una etapa según su tipo. La base de datos aplica la misma regla. */
export function closeRequirement(kind: StageKind, input: CloseInput): CloseError | null {
  if (kind === "perdida") {
    if (!input.lostReason) return "lost_reason_required";
    if (input.lostReason === "otro" && !input.lostNote?.trim()) return "lost_note_required";
  }
  if (kind === "ganada" && !input.wonEvidence?.trim()) return "won_evidence_required";
  return null;
}

/** Siempre debe quedar al menos una etapa activa de cada tipo. */
export function missingKinds(stages: { kind: StageKind; active: boolean }[]): StageKind[] {
  return STAGE_KINDS.filter((k) => !stages.some((s) => s.kind === k && s.active));
}
