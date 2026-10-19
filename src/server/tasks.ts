// SPEC-002 · Tareas, próxima acción y "Mi día".
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { contacts, opportunities, pipelineStages, tasks } from "@/db/schema";
import { endOfLocalDay, isPriority, isTaskKind, type Priority, type TaskKind } from "@/domain/tasks";
import { recordAudit, requirePermission } from "./agencies";
import { logActivity } from "./contacts";
import { AppError, rethrowBusiness } from "./errors";

export type TaskInput = {
  contactId: string;
  opportunityId?: string | null;
  kind: TaskKind;
  title: string;
  assigneeId?: string | null;
  dueAt: Date;
  priority?: Priority;
};

export async function createTask(tx: Tx, userId: string, agencyId: string, input: TaskInput): Promise<string> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const title = input.title.trim();
  if (!title || title.length > 200 || !isTaskKind(input.kind) || Number.isNaN(input.dueAt.getTime())) throw new AppError("invalid_input");
  if (input.priority && !isPriority(input.priority)) throw new AppError("invalid_input");
  const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.agencyId, agencyId)));
  if (!contact) throw new AppError("not_found");
  const assigneeId = input.assigneeId ?? userId;
  try {
    const [row] = await tx
      .insert(tasks)
      .values({ agencyId, contactId: input.contactId, opportunityId: input.opportunityId ?? null, kind: input.kind, title, assigneeId, dueAt: input.dueAt, priority: input.priority ?? "media", createdBy: userId })
      .returning({ id: tasks.id });
    await logActivity(tx, { agencyId, contactId: input.contactId, opportunityId: input.opportunityId ?? null, actorId: userId, kind: "tarea.creada", data: { titulo: title, tipo: input.kind, vence: input.dueAt.toISOString(), asignada: assigneeId } });
    await recordAudit(tx, { agencyId, actorId: userId, action: "task.created", objectType: "task", objectId: row.id, changes: { title, assigneeId } });
    return row.id;
  } catch (err) {
    rethrowBusiness(err);
  }
}

/** Completar exige resultado (RF-211). */
export async function completeTask(tx: Tx, userId: string, agencyId: string, taskId: string, result: string): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const text = result.trim();
  if (!text) throw new AppError("result_required");
  const [row] = await tx
    .update(tasks)
    .set({ status: "completada", result: text, completedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.agencyId, agencyId), eq(tasks.status, "abierta")))
    .returning({ contactId: tasks.contactId, opportunityId: tasks.opportunityId, title: tasks.title });
  if (!row) throw new AppError("not_found");
  await logActivity(tx, { agencyId, contactId: row.contactId, opportunityId: row.opportunityId, actorId: userId, kind: "tarea.completada", data: { titulo: row.title, resultado: text } });
  await recordAudit(tx, { agencyId, actorId: userId, action: "task.completed", objectType: "task", objectId: taskId, changes: { result: text } });
}

export async function cancelTask(tx: Tx, userId: string, agencyId: string, taskId: string, reason: string): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const text = reason.trim();
  if (!text) throw new AppError("invalid_input");
  const [row] = await tx
    .update(tasks)
    .set({ status: "cancelada", result: text })
    .where(and(eq(tasks.id, taskId), eq(tasks.agencyId, agencyId), eq(tasks.status, "abierta")))
    .returning({ contactId: tasks.contactId, opportunityId: tasks.opportunityId, title: tasks.title });
  if (!row) throw new AppError("not_found");
  await logActivity(tx, { agencyId, contactId: row.contactId, opportunityId: row.opportunityId, actorId: userId, kind: "tarea.cancelada", data: { titulo: row.title, motivo: text } });
  await recordAudit(tx, { agencyId, actorId: userId, action: "task.cancelled", objectType: "task", objectId: taskId, reason: text });
}

/** Mis tareas vencidas y de hoy, y mis oportunidades abiertas sin próxima acción (RF-210). */
export async function myDay(tx: Tx, userId: string, agencyId: string, now: Date) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const end = endOfLocalDay(now);
  const due = await tx
    .select({ task: tasks, contactName: contacts.fullName, destination: opportunities.destination })
    .from(tasks)
    .innerJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(opportunities, eq(opportunities.id, tasks.opportunityId))
    .where(and(eq(tasks.agencyId, agencyId), eq(tasks.assigneeId, userId), eq(tasks.status, "abierta"), lt(tasks.dueAt, end)))
    .orderBy(asc(tasks.dueAt));
  const withoutNextAction = await tx
    .select({ id: opportunities.id, contactId: opportunities.contactId, contactName: contacts.fullName, destination: opportunities.destination, stageName: pipelineStages.name, updatedAt: opportunities.updatedAt })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .leftJoin(tasks, and(eq(tasks.opportunityId, opportunities.id), eq(tasks.status, "abierta")))
    .where(and(eq(opportunities.agencyId, agencyId), eq(opportunities.ownerId, userId), eq(pipelineStages.kind, "abierta"), isNull(tasks.id)))
    .orderBy(asc(opportunities.updatedAt));
  return { due, withoutNextAction, endOfDay: end };
}

/** Miembros activos para elegir responsable o asignado. */
export async function activeMembers(tx: Tx, userId: string, agencyId: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const rows = await tx.execute<{ user_id: string; email: string; role: string }>(
    sql`select user_id, email, role from public.memberships where agency_id = ${agencyId} and revoked_at is null order by email`,
  );
  return rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role }));
}
