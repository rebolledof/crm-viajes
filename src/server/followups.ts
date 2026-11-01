// SPEC-002b · Plantillas de seguimiento, horario laboral y permisos de las tareas automáticas.
// La creación y cancelación de tareas la hace la base (trigger opportunities_followups); aquí se
// administran las plantillas y se valida en servidor lo mismo que la base vuelve a comprobar.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { agencySettings, followupSteps, followupTemplates, pipelineStages } from "@/db/schema";
import { isDelayUnit, isEditLevel, isFollowupTrigger, parseTime, type DelayUnit, type EditLevel, type FollowupTrigger } from "@/domain/followups";
import { isLossReason, type LossReason } from "@/domain/pipeline";
import { isPriority, isTaskKind, type Priority, type TaskKind } from "@/domain/tasks";
import { recordAudit, requirePermission } from "./agencies";
import { AppError, fieldError, rethrowBusiness } from "./errors";

export const DEFAULT_SETTINGS = {
  timeZone: "America/Bogota",
  weekdayStart: "08:00",
  weekdayEnd: "18:00",
  saturdayStart: "08:00" as string | null,
  saturdayEnd: "12:00" as string | null,
  allowPersonalTemplates: false,
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(tx: Tx, userId: string, agencyId: string): Promise<Settings> {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const [row] = await tx.select().from(agencySettings).where(eq(agencySettings.agencyId, agencyId));
  if (!row) return { ...DEFAULT_SETTINGS };
  const hhmm = (v: string | null) => (v ? v.slice(0, 5) : null);
  return {
    timeZone: row.timeZone,
    weekdayStart: hhmm(row.weekdayStart)!,
    weekdayEnd: hhmm(row.weekdayEnd)!,
    saturdayStart: hhmm(row.saturdayStart),
    saturdayEnd: hhmm(row.saturdayEnd),
    allowPersonalTemplates: row.allowPersonalTemplates,
  };
}

export type SettingsInput = { weekdayStart: string; weekdayEnd: string; saturdayStart?: string | null; saturdayEnd?: string | null; allowPersonalTemplates: boolean };

export async function updateSettings(tx: Tx, userId: string, agencyId: string, input: SettingsInput): Promise<void> {
  await requirePermission(tx, userId, agencyId, "followups.manage");
  const ws = parseTime(input.weekdayStart);
  const we = parseTime(input.weekdayEnd);
  if (!ws) throw fieldError("invalid_input", "weekdayStart");
  if (!we || we <= ws) throw fieldError("invalid_input", "weekdayEnd");
  const ssRaw = input.saturdayStart?.trim() || null;
  const seRaw = input.saturdayEnd?.trim() || null;
  const ss = ssRaw ? parseTime(ssRaw) : null;
  const se = seRaw ? parseTime(seRaw) : null;
  if ((ssRaw && !ss) || (seRaw && !se) || !ss !== !se || (ss && se && se <= ss)) throw fieldError("invalid_input", "saturdayEnd");
  const values = { weekdayStart: ws, weekdayEnd: we, saturdayStart: ss, saturdayEnd: se, allowPersonalTemplates: input.allowPersonalTemplates, updatedAt: new Date() };
  await tx.insert(agencySettings).values({ agencyId, ...values }).onConflictDoUpdate({ target: agencySettings.agencyId, set: values });
  await recordAudit(tx, { agencyId, actorId: userId, action: "settings.updated", objectType: "agency", objectId: agencyId, changes: values });
}

/** Plantillas visibles para el usuario (RLS filtra las personales ajenas) con sus pasos. */
export async function listTemplates(tx: Tx, userId: string, agencyId: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const templates = await tx
    .select({ t: followupTemplates, stageName: pipelineStages.name })
    .from(followupTemplates)
    .leftJoin(pipelineStages, eq(pipelineStages.id, followupTemplates.stageId))
    .where(eq(followupTemplates.agencyId, agencyId))
    .orderBy(asc(followupTemplates.ownerId), asc(followupTemplates.createdAt));
  const steps = await tx.select().from(followupSteps).where(eq(followupSteps.agencyId, agencyId)).orderBy(asc(followupSteps.position), asc(followupSteps.createdAt));
  return templates.map(({ t, stageName }) => ({ ...t, stageName, steps: steps.filter((s) => s.templateId === t.id) }));
}

export async function getTemplate(tx: Tx, userId: string, agencyId: string, templateId: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const [t] = await tx.select().from(followupTemplates).where(and(eq(followupTemplates.id, templateId), eq(followupTemplates.agencyId, agencyId)));
  if (!t) throw new AppError("not_found");
  const steps = await tx.select().from(followupSteps).where(eq(followupSteps.templateId, templateId)).orderBy(asc(followupSteps.position), asc(followupSteps.createdAt));
  return { ...t, steps };
}

/** El administrador escribe todas; un asesor solo las suyas y si la agencia lo permite (RF-227). */
async function requireTemplateWrite(tx: Tx, userId: string, agencyId: string, ownerId: string | null): Promise<void> {
  const role = await requirePermission(tx, userId, agencyId, "crm.read");
  if (role === "admin") return;
  if (role !== "asesor" || ownerId !== userId) throw new AppError("permission_denied");
  const [s] = await tx.select({ allow: agencySettings.allowPersonalTemplates }).from(agencySettings).where(eq(agencySettings.agencyId, agencyId));
  if (!s?.allow) throw new AppError("personal_templates_off");
}

async function loadWritableTemplate(tx: Tx, userId: string, agencyId: string, templateId: string) {
  const [t] = await tx.select().from(followupTemplates).where(and(eq(followupTemplates.id, templateId), eq(followupTemplates.agencyId, agencyId)));
  if (!t) throw new AppError("not_found");
  await requireTemplateWrite(tx, userId, agencyId, t.ownerId);
  return t;
}

export type TemplateInput = {
  name: string;
  trigger: FollowupTrigger;
  stageId?: string | null;
  lossReasons?: LossReason[];
  stopStageId?: string | null;
  editLevel: EditLevel;
};

async function prepareTemplate(tx: Tx, agencyId: string, input: TemplateInput) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw fieldError("invalid_input", "templateName");
  if (!isFollowupTrigger(input.trigger)) throw fieldError("invalid_input", "trigger");
  if (!isEditLevel(input.editLevel)) throw fieldError("invalid_input", "editLevel");
  const stageId = input.trigger === "etapa" ? input.stageId || null : null;
  if (input.trigger === "etapa" && !stageId) throw new AppError("stage_required");
  const lossReasons = input.trigger === "perdida" ? (input.lossReasons ?? []).filter(isLossReason) : [];
  const stopStageId = input.trigger === "ganada" || input.trigger === "perdida" ? null : input.stopStageId || null;
  for (const id of [stageId, stopStageId]) {
    if (!id) continue;
    const [s] = await tx.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.id, id), eq(pipelineStages.agencyId, agencyId)));
    if (!s) throw new AppError("not_found");
  }
  return { name, trigger: input.trigger, stageId, lossReasons, stopStageId, editLevel: input.editLevel };
}

export async function createTemplate(tx: Tx, userId: string, agencyId: string, input: TemplateInput & { personal?: boolean }): Promise<string> {
  const ownerId = input.personal ? userId : null;
  await requireTemplateWrite(tx, userId, agencyId, ownerId);
  const fields = await prepareTemplate(tx, agencyId, input);
  try {
    const [row] = await tx.insert(followupTemplates).values({ agencyId, ownerId, createdBy: userId, ...fields }).returning({ id: followupTemplates.id });
    await recordAudit(tx, { agencyId, actorId: userId, action: "followup.template_created", objectType: "followup_template", objectId: row.id, changes: { ...fields, ownerId } });
    return row.id;
  } catch (err) {
    rethrowBusiness(err);
  }
}

export async function updateTemplate(tx: Tx, userId: string, agencyId: string, templateId: string, input: TemplateInput & { active?: boolean }): Promise<void> {
  await loadWritableTemplate(tx, userId, agencyId, templateId);
  const fields = await prepareTemplate(tx, agencyId, input);
  const set = { ...fields, ...(input.active === undefined ? {} : { active: input.active }) };
  try {
    await tx.update(followupTemplates).set(set).where(and(eq(followupTemplates.id, templateId), eq(followupTemplates.agencyId, agencyId)));
  } catch (err) {
    rethrowBusiness(err);
  }
  await recordAudit(tx, { agencyId, actorId: userId, action: "followup.template_updated", objectType: "followup_template", objectId: templateId, changes: set });
}

export async function setTemplateActive(tx: Tx, userId: string, agencyId: string, templateId: string, active: boolean): Promise<void> {
  await loadWritableTemplate(tx, userId, agencyId, templateId);
  await tx.update(followupTemplates).set({ active }).where(and(eq(followupTemplates.id, templateId), eq(followupTemplates.agencyId, agencyId)));
  await recordAudit(tx, { agencyId, actorId: userId, action: "followup.template_updated", objectType: "followup_template", objectId: templateId, changes: { active } });
}

export type StepInput = {
  kind: TaskKind;
  title: string;
  delayAmount: number;
  delayUnit: DelayUnit;
  atTime?: string | null;
  priority?: Priority;
  message?: string | null;
  locked?: boolean;
};

function prepareStep(input: StepInput) {
  const title = input.title.trim();
  if (!title || title.length > 200) throw fieldError("invalid_input", "title");
  if (!isTaskKind(input.kind)) throw fieldError("invalid_input", "kind");
  if (!isDelayUnit(input.delayUnit)) throw fieldError("invalid_input", "delayUnit");
  if (!Number.isInteger(input.delayAmount) || input.delayAmount < 0 || input.delayAmount > 525600) throw fieldError("invalid_input", "delayAmount");
  const rawAt = input.atTime?.trim() || null;
  const atTime = rawAt ? parseTime(rawAt) : null;
  if (rawAt && (!atTime || (input.delayUnit !== "dias_habiles" && input.delayUnit !== "dias"))) throw fieldError("invalid_input", "atTime");
  if (input.priority && !isPriority(input.priority)) throw fieldError("invalid_input", "priority");
  const message = input.message?.trim() || null;
  if (message && message.length > 1000) throw fieldError("invalid_input", "message");
  return { kind: input.kind, title, delayAmount: input.delayAmount, delayUnit: input.delayUnit, atTime, priority: input.priority ?? "media", message, locked: input.locked ?? false };
}

export async function addStep(tx: Tx, userId: string, agencyId: string, templateId: string, input: StepInput): Promise<string> {
  await loadWritableTemplate(tx, userId, agencyId, templateId);
  const fields = prepareStep(input);
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${followupSteps.position}) + 1, 0)::int` })
    .from(followupSteps)
    .where(eq(followupSteps.templateId, templateId));
  const [row] = await tx.insert(followupSteps).values({ agencyId, templateId, position: next, ...fields }).returning({ id: followupSteps.id });
  await recordAudit(tx, { agencyId, actorId: userId, action: "followup.step_created", objectType: "followup_template", objectId: templateId, changes: fields });
  return row.id;
}

async function loadStep(tx: Tx, userId: string, agencyId: string, stepId: string) {
  const [s] = await tx.select().from(followupSteps).where(and(eq(followupSteps.id, stepId), eq(followupSteps.agencyId, agencyId)));
  if (!s) throw new AppError("not_found");
  await loadWritableTemplate(tx, userId, agencyId, s.templateId);
  return s;
}

export async function updateStep(tx: Tx, userId: string, agencyId: string, stepId: string, input: StepInput): Promise<void> {
  const step = await loadStep(tx, userId, agencyId, stepId);
  const fields = prepareStep(input);
  await tx.update(followupSteps).set(fields).where(eq(followupSteps.id, stepId));
  await recordAudit(tx, { agencyId, actorId: userId, action: "followup.step_updated", objectType: "followup_template", objectId: step.templateId, changes: { stepId, ...fields } });
}

/** Borra un paso; las tareas que ya creó no cambian (step_id queda vacío). */
export async function deleteStep(tx: Tx, userId: string, agencyId: string, stepId: string): Promise<string> {
  const step = await loadStep(tx, userId, agencyId, stepId);
  await tx.delete(followupSteps).where(eq(followupSteps.id, stepId));
  await recordAudit(tx, { agencyId, actorId: userId, action: "followup.step_deleted", objectType: "followup_template", objectId: step.templateId, changes: { stepId, title: step.title } });
  return step.templateId;
}

/** Sube o baja un paso un puesto. */
export async function moveStep(tx: Tx, userId: string, agencyId: string, stepId: string, direction: "up" | "down"): Promise<string> {
  const step = await loadStep(tx, userId, agencyId, stepId);
  const steps = await tx.select({ id: followupSteps.id }).from(followupSteps).where(eq(followupSteps.templateId, step.templateId)).orderBy(asc(followupSteps.position), asc(followupSteps.createdAt));
  const order = steps.map((s) => s.id);
  const i = order.indexOf(stepId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return step.templateId;
  [order[i], order[j]] = [order[j], order[i]];
  for (const [position, id] of order.entries()) await tx.update(followupSteps).set({ position }).where(eq(followupSteps.id, id));
  return step.templateId;
}
