// SPEC-002 · Tareas, próxima acción y "Mi día".
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { agencies, contactConsents, contactEmails, contactPhones, contacts, opportunities, pipelineStages, tasks } from "@/db/schema";
import { fillMessage, mailtoLink, taskPermissions, type ContactChannels } from "@/domain/followups";
import { DEFAULT_WHATSAPP_TEMPLATE } from "@/domain/whatsapp";
import { endOfLocalDay, isPriority, isTaskKind, type Priority, type TaskKind } from "@/domain/tasks";
import { recordAudit, requirePermission } from "./agencies";
import { currentConsents, logActivity, openWhatsapp } from "./contacts";
import { AppError, fieldError, rethrowBusiness } from "./errors";

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
  if (!title || title.length > 200) throw fieldError("invalid_input", "title");
  if (!isTaskKind(input.kind) || Number.isNaN(input.dueAt.getTime())) throw fieldError("invalid_input", "dueAt");
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

async function loadOpenTask(tx: Tx, agencyId: string, taskId: string) {
  const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.agencyId, agencyId), eq(tasks.status, "abierta")));
  if (!task) throw new AppError("not_found");
  return task;
}

/** Cancelar una tarea automática depende de su nivel de edición (RF-226). */
export async function cancelTask(tx: Tx, userId: string, agencyId: string, taskId: string, reason: string): Promise<void> {
  const role = await requirePermission(tx, userId, agencyId, "crm.write");
  const text = reason.trim();
  if (!text) throw fieldError("invalid_input", "reason");
  const task = await loadOpenTask(tx, agencyId, taskId);
  if (!taskPermissions(role, task.editLevel).cancel) throw new AppError("task_locked");
  try {
    await tx.update(tasks).set({ status: "cancelada", result: text }).where(and(eq(tasks.id, taskId), eq(tasks.agencyId, agencyId)));
  } catch (err) {
    rethrowBusiness(err);
  }
  await logActivity(tx, { agencyId, contactId: task.contactId, opportunityId: task.opportunityId, actorId: userId, kind: "tarea.cancelada", data: { titulo: task.title, motivo: text } });
  await recordAudit(tx, { agencyId, actorId: userId, action: "task.cancelled", objectType: "task", objectId: taskId, reason: text });
}

export type TaskUpdate = { dueAt?: Date; priority?: Priority; message?: string | null; assigneeId?: string };

/**
 * Ajusta una tarea abierta. Fecha, prioridad y mensaje necesitan nivel ajustable o libre; reasignar,
 * libre. El administrador puede todo. La base lo vuelve a comprobar con tasks_edit_guard.
 */
export async function updateTask(tx: Tx, userId: string, agencyId: string, taskId: string, input: TaskUpdate): Promise<void> {
  const role = await requirePermission(tx, userId, agencyId, "crm.write");
  const task = await loadOpenTask(tx, agencyId, taskId);
  const perms = taskPermissions(role, task.editLevel);
  const set: { dueAt?: Date; priority?: Priority; message?: string | null; assigneeId?: string } = {};
  if (input.dueAt !== undefined && input.dueAt.getTime() !== task.dueAt.getTime()) {
    if (Number.isNaN(input.dueAt.getTime())) throw fieldError("invalid_input", "dueAt");
    set.dueAt = input.dueAt;
  }
  if (input.priority !== undefined && input.priority !== task.priority) {
    if (!isPriority(input.priority)) throw new AppError("invalid_input");
    set.priority = input.priority;
  }
  if (input.message !== undefined) {
    const message = input.message?.trim() || null;
    if (message && message.length > 1000) throw fieldError("invalid_input", "message");
    if (message !== task.message) set.message = message;
  }
  if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId) set.assigneeId = input.assigneeId;
  if (Object.keys(set).length === 0) return;
  if ((set.dueAt || set.priority || "message" in set) && !perms.adjust) throw new AppError("task_locked");
  if (set.assigneeId && !perms.reassign) throw new AppError("task_locked");
  try {
    await tx.update(tasks).set(set).where(and(eq(tasks.id, taskId), eq(tasks.agencyId, agencyId)));
  } catch (err) {
    rethrowBusiness(err);
  }
  const changes = {
    ...(set.dueAt ? { vence: set.dueAt.toISOString() } : {}),
    ...(set.priority ? { prioridad: set.priority } : {}),
    ...("message" in set ? { mensaje: set.message } : {}),
    ...(set.assigneeId ? { asignada: set.assigneeId } : {}),
  };
  await logActivity(tx, { agencyId, contactId: task.contactId, opportunityId: task.opportunityId, actorId: userId, kind: "tarea.editada", data: { titulo: task.title, ...changes } });
  await recordAudit(tx, { agencyId, actorId: userId, action: "task.updated", objectType: "task", objectId: taskId, changes });
}

/**
 * Acción de un clic de una tarea de WhatsApp o correo (SPEC-002b): rellena el mensaje con los datos
 * del contacto y devuelve el enlace. No envía nada; quien envía es el asesor. Respeta consentimientos.
 */
export async function openTaskLink(tx: Tx, userId: string, agencyId: string, taskId: string): Promise<{ link: string; channel: "whatsapp" | "correo" }> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const [row] = await tx
    .select({ task: tasks, contactName: contacts.fullName, agencyName: agencies.name, destination: opportunities.destination })
    .from(tasks)
    .innerJoin(contacts, eq(contacts.id, tasks.contactId))
    .innerJoin(agencies, eq(agencies.id, tasks.agencyId))
    .leftJoin(opportunities, eq(opportunities.id, tasks.opportunityId))
    .where(and(eq(tasks.id, taskId), eq(tasks.agencyId, agencyId), eq(tasks.status, "abierta")));
  if (!row) throw new AppError("not_found");
  const { task } = row;
  const values = { nombre: row.contactName, agencia: row.agencyName, destino: row.destination };
  if (task.kind === "whatsapp") {
    const message = fillMessage(task.message ?? DEFAULT_WHATSAPP_TEMPLATE, values);
    return { link: await openWhatsapp(tx, userId, agencyId, task.contactId, { message, opportunityId: task.opportunityId }), channel: "whatsapp" };
  }
  if (task.kind !== "correo") throw new AppError("invalid_input");
  const [email] = await tx
    .select({ email: contactEmails.email })
    .from(contactEmails)
    .where(and(eq(contactEmails.contactId, task.contactId), eq(contactEmails.agencyId, agencyId)))
    .orderBy(desc(contactEmails.isPreferred), contactEmails.createdAt)
    .limit(1);
  if (!email) throw new AppError("no_email");
  const consents = await currentConsents(tx, task.contactId);
  if (consents.some((c) => c.channel === "correo" && c.purpose === "servicio" && c.status === "retirado")) throw new AppError("email_blocked");
  const body = fillMessage(task.message ?? "Hola {nombre},", values);
  const subject = fillMessage("Tu viaje a {destino} con {agencia}", values);
  await logActivity(tx, { agencyId, contactId: task.contactId, opportunityId: task.opportunityId, actorId: userId, kind: "correo.abierto", data: { correo: email.email, asunto: subject, mensaje: body } });
  return { link: mailtoLink(email.email, subject, body), channel: "correo" };
}

/**
 * Para cada contacto: si tiene teléfono y correo, y si retiró el permiso de WhatsApp o de correo
 * (último registro por canal y propósito "servicio"). Lo usan los botones de las tareas.
 */
export async function contactChannels(tx: Tx, userId: string, agencyId: string, contactIds: string[]): Promise<Map<string, ContactChannels>> {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const ids = [...new Set(contactIds)];
  const out = new Map<string, ContactChannels>();
  if (ids.length === 0) return out;
  const [phones, emails, consents] = await Promise.all([
    tx.selectDistinct({ id: contactPhones.contactId }).from(contactPhones).where(and(eq(contactPhones.agencyId, agencyId), inArray(contactPhones.contactId, ids))),
    tx.selectDistinct({ id: contactEmails.contactId }).from(contactEmails).where(and(eq(contactEmails.agencyId, agencyId), inArray(contactEmails.contactId, ids))),
    tx
      .selectDistinctOn([contactConsents.contactId, contactConsents.channel], { id: contactConsents.contactId, channel: contactConsents.channel, status: contactConsents.status })
      .from(contactConsents)
      .where(and(eq(contactConsents.agencyId, agencyId), eq(contactConsents.purpose, "servicio"), inArray(contactConsents.contactId, ids)))
      .orderBy(contactConsents.contactId, contactConsents.channel, desc(contactConsents.createdAt), desc(contactConsents.id)),
  ]);
  const has = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  const withPhone = has(phones);
  const withEmail = has(emails);
  const withdrawn = new Set(consents.filter((c) => c.status === "retirado").map((c) => `${c.id}:${c.channel}`));
  for (const id of ids) {
    out.set(id, { phone: withPhone.has(id), email: withEmail.has(id), whatsappAllowed: !withdrawn.has(`${id}:whatsapp`), emailAllowed: !withdrawn.has(`${id}:correo`) });
  }
  return out;
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
  // Lo que viene después de hoy, para que una tarea futura no "desaparezca" de la vista diaria.
  const upcoming = await tx
    .select({ task: tasks, contactName: contacts.fullName, destination: opportunities.destination })
    .from(tasks)
    .innerJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(opportunities, eq(opportunities.id, tasks.opportunityId))
    .where(and(eq(tasks.agencyId, agencyId), eq(tasks.assigneeId, userId), eq(tasks.status, "abierta"), gte(tasks.dueAt, end)))
    .orderBy(asc(tasks.dueAt))
    .limit(50);
  const withoutNextAction = await tx
    .select({ id: opportunities.id, contactId: opportunities.contactId, contactName: contacts.fullName, destination: opportunities.destination, stageName: pipelineStages.name, updatedAt: opportunities.updatedAt })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .leftJoin(tasks, and(eq(tasks.opportunityId, opportunities.id), eq(tasks.status, "abierta")))
    .where(and(eq(opportunities.agencyId, agencyId), eq(opportunities.ownerId, userId), eq(pipelineStages.kind, "abierta"), isNull(tasks.id)))
    .orderBy(asc(opportunities.updatedAt));
  return { due, upcoming, withoutNextAction, endOfDay: end };
}

/** Miembros activos para elegir responsable o asignado. */
export const TASK_STATUSES = ["abierta", "completada", "cancelada"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Módulo de Tareas (RF-218): todas las tareas de la agencia con filtros. */
export async function listTasks(tx: Tx, userId: string, agencyId: string, filter: { assigneeId?: string; status?: TaskStatus; kind?: TaskKind } = {}) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const open = (filter.status ?? "abierta") === "abierta";
  return tx
    .select({ task: tasks, contactName: contacts.fullName, destination: opportunities.destination })
    .from(tasks)
    .innerJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(opportunities, eq(opportunities.id, tasks.opportunityId))
    .where(
      and(
        eq(tasks.agencyId, agencyId),
        eq(tasks.status, filter.status ?? "abierta"),
        filter.assigneeId ? eq(tasks.assigneeId, filter.assigneeId) : undefined,
        filter.kind ? eq(tasks.kind, filter.kind) : undefined,
      ),
    )
    // Abiertas: la más urgente primero. Cerradas: la más reciente primero.
    .orderBy(open ? asc(tasks.dueAt) : desc(tasks.completedAt), desc(tasks.createdAt))
    .limit(300);
}

export async function activeMembers(tx: Tx, userId: string, agencyId: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const rows = await tx.execute<{ user_id: string; email: string; role: string }>(
    sql`select user_id, email, role from public.memberships where agency_id = ${agencyId} and revoked_at is null order by email`,
  );
  return rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role }));
}
