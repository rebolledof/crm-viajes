// SPEC-002 · Embudo por agencia y oportunidades.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { contacts, opportunities, pipelineStages, tasks } from "@/db/schema";
import { isCurrency, parseAmount, type Currency } from "@/domain/money";
import { closeRequirement, missingKinds, type LossReason, type StageKind } from "@/domain/pipeline";
import type { Priority } from "@/domain/tasks";
import { recordAudit, requirePermission } from "./agencies";
import { logActivity } from "./contacts";
import { AppError, pgError, rethrowBusiness } from "./errors";

export async function listStages(tx: Tx, userId: string, agencyId: string, opts: { includeInactive?: boolean } = {}) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  return tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.agencyId, agencyId), opts.includeInactive ? undefined : eq(pipelineStages.active, true)))
    .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));
}

function stageName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 60) throw new AppError("invalid_input");
  return name;
}

async function guardStageWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (pgError(err)?.code === "23505") throw new AppError("stage_name_taken");
    rethrowBusiness(err);
  }
}

export async function createStage(tx: Tx, userId: string, agencyId: string, input: { name: string; kind: StageKind }): Promise<string> {
  await requirePermission(tx, userId, agencyId, "pipeline.manage");
  const name = stageName(input.name);
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${pipelineStages.position}) + 1, 0)::int` })
    .from(pipelineStages)
    .where(eq(pipelineStages.agencyId, agencyId));
  const [row] = await guardStageWrite(() => tx.insert(pipelineStages).values({ agencyId, name, kind: input.kind, position: next }).returning({ id: pipelineStages.id }));
  await recordAudit(tx, { agencyId, actorId: userId, action: "stage.created", objectType: "stage", objectId: row.id, changes: { name, kind: input.kind } });
  return row.id;
}

export async function updateStage(tx: Tx, userId: string, agencyId: string, stageId: string, input: { name?: string; active?: boolean }): Promise<void> {
  await requirePermission(tx, userId, agencyId, "pipeline.manage");
  const set: { name?: string; active?: boolean } = {};
  if (input.name !== undefined) set.name = stageName(input.name);
  if (input.active !== undefined) set.active = input.active;
  if (input.active === false) {
    const all = await tx.select({ id: pipelineStages.id, kind: pipelineStages.kind, active: pipelineStages.active }).from(pipelineStages).where(eq(pipelineStages.agencyId, agencyId));
    if (missingKinds(all.map((s) => ({ kind: s.kind, active: s.id === stageId ? false : s.active }))).length) throw new AppError("last_stage_of_kind");
  }
  const rows = await guardStageWrite(() =>
    tx.update(pipelineStages).set(set).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.agencyId, agencyId))).returning({ id: pipelineStages.id }),
  );
  if (!rows.length) throw new AppError("not_found");
  await recordAudit(tx, { agencyId, actorId: userId, action: "stage.updated", objectType: "stage", objectId: stageId, changes: set });
}

/** Reordena las etapas según la lista de ids recibida (RF-215). */
export async function reorderStages(tx: Tx, userId: string, agencyId: string, orderedIds: string[]): Promise<void> {
  await requirePermission(tx, userId, agencyId, "pipeline.manage");
  const existing = await tx.select({ id: pipelineStages.id }).from(pipelineStages).where(eq(pipelineStages.agencyId, agencyId));
  const ids = new Set(existing.map((s) => s.id));
  if (orderedIds.length !== ids.size || !orderedIds.every((id) => ids.has(id))) throw new AppError("invalid_input");
  for (const [position, id] of orderedIds.entries()) {
    await tx.update(pipelineStages).set({ position }).where(and(eq(pipelineStages.id, id), eq(pipelineStages.agencyId, agencyId)));
  }
  await recordAudit(tx, { agencyId, actorId: userId, action: "stage.reordered", objectType: "stage", changes: { order: orderedIds } });
}

export type OpportunityInput = {
  contactId: string;
  stageId?: string | null;
  ownerId?: string | null;
  source?: string | null;
  destination?: string | null;
  product?: string | null;
  travelStart?: string | null;
  travelEnd?: string | null;
  dateFlexibility?: string | null;
  travelers?: number | null;
  budgetAmount?: string | null;
  budgetCurrency?: string | null;
  priority?: Priority;
  notes?: string | null;
};

const blank = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Campos comunes de crear y editar. Lo vacío queda como desconocido, sin inferencias (RF-206). */
function prepareFields(input: Omit<OpportunityInput, "contactId" | "stageId">) {
  const amountRaw = blank(input.budgetAmount);
  const currency = blank(input.budgetCurrency);
  let budgetAmount: string | null = null;
  let budgetCurrency: Currency | null = null;
  if (amountRaw || currency) {
    // RF-207: no hay importe sin moneda ni moneda sin importe.
    if (!amountRaw || !currency || !isCurrency(currency)) throw new AppError("invalid_amount");
    budgetAmount = parseAmount(amountRaw, currency);
    if (budgetAmount === null) throw new AppError("invalid_amount");
    budgetCurrency = currency;
  }
  const travelStart = blank(input.travelStart);
  const travelEnd = blank(input.travelEnd);
  if ((travelStart && !ISO_DATE.test(travelStart)) || (travelEnd && !ISO_DATE.test(travelEnd))) throw new AppError("invalid_input");
  if (travelStart && travelEnd && travelEnd < travelStart) throw new AppError("invalid_input");
  const travelers = input.travelers ?? null;
  if (travelers !== null && (!Number.isInteger(travelers) || travelers < 1 || travelers > 999)) throw new AppError("invalid_input");
  return {
    ownerId: input.ownerId ?? null,
    source: blank(input.source),
    destination: blank(input.destination),
    product: blank(input.product),
    travelStart,
    travelEnd,
    dateFlexibility: blank(input.dateFlexibility),
    travelers,
    budgetAmount,
    budgetCurrency,
    priority: input.priority ?? "media",
    notes: blank(input.notes),
  };
}

export async function createOpportunity(tx: Tx, userId: string, agencyId: string, input: OpportunityInput): Promise<string> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const fields = prepareFields({ ...input, ownerId: input.ownerId === undefined ? userId : input.ownerId });
  const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.agencyId, agencyId)));
  if (!contact) throw new AppError("not_found");
  let stageId = input.stageId ?? null;
  if (!stageId) {
    const [first] = await tx
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.agencyId, agencyId), eq(pipelineStages.active, true), eq(pipelineStages.kind, "abierta")))
      .orderBy(asc(pipelineStages.position))
      .limit(1);
    stageId = first?.id ?? null;
  }
  if (!stageId) throw new AppError("stage_inactive");
  const [stage] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.agencyId, agencyId)));
  if (!stage) throw new AppError("not_found");
  // Una oportunidad nueva siempre empieza abierta; se cierra moviéndola.
  if (stage.kind !== "abierta") throw new AppError("invalid_input");
  try {
    const [row] = await tx.insert(opportunities).values({ agencyId, contactId: input.contactId, stageId, createdBy: userId, ...fields }).returning({ id: opportunities.id });
    await logActivity(tx, { agencyId, contactId: input.contactId, opportunityId: row.id, actorId: userId, kind: "oportunidad.creada", data: { destino: fields.destination, etapa: stage.name } });
    await recordAudit(tx, { agencyId, actorId: userId, action: "opportunity.created", objectType: "opportunity", objectId: row.id, changes: { contactId: input.contactId, stage: stage.name, destination: fields.destination } });
    return row.id;
  } catch (err) {
    rethrowBusiness(err);
  }
}

export async function updateOpportunity(tx: Tx, userId: string, agencyId: string, opportunityId: string, input: Omit<OpportunityInput, "contactId" | "stageId">): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const fields = prepareFields(input);
  const [before] = await tx.select().from(opportunities).where(and(eq(opportunities.id, opportunityId), eq(opportunities.agencyId, agencyId)));
  if (!before) throw new AppError("not_found");
  try {
    await tx.update(opportunities).set(fields).where(and(eq(opportunities.id, opportunityId), eq(opportunities.agencyId, agencyId)));
  } catch (err) {
    rethrowBusiness(err);
  }
  if (before.ownerId !== fields.ownerId) {
    await logActivity(tx, { agencyId, contactId: before.contactId, opportunityId, actorId: userId, kind: "oportunidad.responsable", data: { de: before.ownerId, a: fields.ownerId } });
  }
  await recordAudit(tx, { agencyId, actorId: userId, action: "opportunity.updated", objectType: "opportunity", objectId: opportunityId, changes: fields });
}

export type MoveInput = { stageId: string; lostReason?: LossReason | null; lostNote?: string | null; wonEvidence?: string | null; reason?: string | null };

/** Mueve a cualquier etapa activa, saltando las intermedias (RF-216), con las reglas de cierre. */
export async function moveOpportunity(tx: Tx, userId: string, agencyId: string, opportunityId: string, input: MoveInput): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const [current] = await tx
    .select({ opp: opportunities, kind: pipelineStages.kind, name: pipelineStages.name })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.agencyId, agencyId)));
  if (!current) throw new AppError("not_found");
  const [target] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.agencyId, agencyId)));
  if (!target) throw new AppError("not_found");
  if (!target.active) throw new AppError("stage_inactive");
  if (target.id === current.opp.stageId) return;
  const problem = closeRequirement(target.kind, input);
  if (problem) throw new AppError(problem);
  const reopening = current.kind !== "abierta" && target.kind === "abierta";
  const reason = input.reason?.trim() || null;
  if (reopening && !reason) throw new AppError("reopen_reason_required");
  try {
    await tx
      .update(opportunities)
      .set({
        stageId: target.id,
        lostReason: target.kind === "perdida" ? input.lostReason : null,
        lostNote: target.kind === "perdida" ? input.lostNote?.trim() || null : null,
        wonEvidence: target.kind === "ganada" ? input.wonEvidence?.trim() : null,
      })
      .where(and(eq(opportunities.id, opportunityId), eq(opportunities.agencyId, agencyId)));
  } catch (err) {
    rethrowBusiness(err);
  }
  const changes = {
    de: current.name,
    a: target.name,
    ...(target.kind === "perdida" ? { motivo: input.lostReason, nota: input.lostNote?.trim() || null } : {}),
    ...(target.kind === "ganada" ? { evidencia: input.wonEvidence?.trim() } : {}),
  };
  await logActivity(tx, { agencyId, contactId: current.opp.contactId, opportunityId, actorId: userId, kind: reopening ? "oportunidad.reabierta" : "oportunidad.etapa", data: { ...changes, ...(reason ? { razon: reason } : {}) } });
  await recordAudit(tx, { agencyId, actorId: userId, action: "opportunity.stage_changed", objectType: "opportunity", objectId: opportunityId, changes, reason: reason ?? undefined });
}

const OPP_ID = sql.raw('"opportunities"."id"');
const nextActionSql = sql<string | null>`(select t.due_at from ${tasks} t where t.opportunity_id = ${OPP_ID} and t.status = 'abierta' order by t.due_at limit 1)`;
const nextActionTitleSql = sql<string | null>`(select t.title from ${tasks} t where t.opportunity_id = ${OPP_ID} and t.status = 'abierta' order by t.due_at limit 1)`;

/** Oportunidades para el tablero y la lista, con su próxima acción (RF-210). */
export async function listOpportunities(tx: Tx, userId: string, agencyId: string, filter: { ownerId?: string; contactId?: string } = {}) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  return tx
    .select({
      id: opportunities.id,
      contactId: opportunities.contactId,
      contactName: contacts.fullName,
      stageId: opportunities.stageId,
      stageKind: pipelineStages.kind,
      ownerId: opportunities.ownerId,
      destination: opportunities.destination,
      travelStart: opportunities.travelStart,
      travelers: opportunities.travelers,
      budgetAmount: opportunities.budgetAmount,
      budgetCurrency: opportunities.budgetCurrency,
      priority: opportunities.priority,
      updatedAt: opportunities.updatedAt,
      nextActionAt: nextActionSql,
      nextActionTitle: nextActionTitleSql,
    })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(
      and(
        eq(opportunities.agencyId, agencyId),
        filter.ownerId ? eq(opportunities.ownerId, filter.ownerId) : undefined,
        filter.contactId ? eq(opportunities.contactId, filter.contactId) : undefined,
      ),
    )
    .orderBy(desc(opportunities.updatedAt))
    .limit(500);
}

export async function getOpportunity(tx: Tx, userId: string, agencyId: string, opportunityId: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const [row] = await tx
    .select({ opp: opportunities, contactName: contacts.fullName, stageName: pipelineStages.name, stageKind: pipelineStages.kind })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.agencyId, agencyId)));
  if (!row) throw new AppError("not_found");
  const openTasks = await tx.select().from(tasks).where(and(eq(tasks.opportunityId, opportunityId), eq(tasks.status, "abierta"))).orderBy(tasks.dueAt);
  return { ...row, openTasks };
}
