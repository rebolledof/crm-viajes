// SPEC-003 · Bandeja unificada: listas, conversación, tomar, reasignar, resolver, responder,
// respuestas guardadas y ajustes de canales. Todo corre dentro de withUser: RLS limita a la
// agencia y aquí se validan permisos para devolver errores claros.
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  activities,
  agencies,
  agencySettings,
  contactEmails,
  contactPhones,
  contacts,
  conversations,
  inboundChannels,
  memberships,
  messages,
  opportunities,
  pipelineStages,
  savedReplies,
  tasks,
} from "@/db/schema";
import { mailtoLink } from "@/domain/followups";
import { MAX_MESSAGE, normalizeShortcut, type InboxFilter } from "@/domain/inbox";
import { whatsappLink } from "@/domain/whatsapp";
import { recordAudit, requirePermission } from "./agencies";
import { createOpportunity } from "./opportunities";
import { currentConsents, logActivity, sendableEmail, sendablePhone } from "./contacts";
import { AppError, fieldError, pgError, requireIds, rethrowBusiness } from "./errors";

/** Condición "sin responder": abierta y con el plazo vencido (RF-265). */
const overdue = (now: Date) => and(eq(conversations.status, "abierta"), lt(conversations.replyDueAt, now));

export type InboxRow = {
  id: string;
  channel: "formulario" | "chat" | "correo";
  status: "abierta" | "pendiente" | "resuelta";
  assigneeId: string | null;
  opportunityId: string | null;
  subject: string | null;
  replyDueAt: Date | null;
  lastInboundAt: Date | null;
  updatedAt: Date;
  contactId: string;
  contactName: string;
  preview: string | null;
};

export async function listConversations(
  tx: Tx,
  userId: string,
  agencyId: string,
  opts: { filter: InboxFilter; q?: string; now: Date; limit?: number },
): Promise<InboxRow[]> {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const where: (SQL | undefined)[] = [eq(conversations.agencyId, agencyId)];
  if (opts.filter === "sin_responder") where.push(overdue(opts.now));
  if (opts.filter === "mias") where.push(eq(conversations.assigneeId, userId), sql`${conversations.status} <> 'resuelta'`);
  if (opts.filter === "sin_asignar") where.push(isNull(conversations.assigneeId), sql`${conversations.status} <> 'resuelta'`);
  if (opts.filter === "todas") where.push(sql`${conversations.status} <> 'resuelta'`);
  if (opts.filter === "resueltas") where.push(eq(conversations.status, "resuelta"));
  const q = opts.q?.trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, "");
    where.push(
      or(
        ilike(contacts.fullName, like),
        sql`exists (select 1 from public.contact_emails e where e.contact_id = ${contacts.id} and e.email ilike ${like})`,
        digits.length >= 4 ? sql`exists (select 1 from public.contact_phones p where p.contact_id = ${contacts.id} and p.e164 like ${`%${digits}%`})` : undefined,
      ),
    );
  }
  const rows = await tx
    .select({
      id: conversations.id,
      channel: conversations.channel,
      status: conversations.status,
      assigneeId: conversations.assigneeId,
      opportunityId: conversations.opportunityId,
      subject: conversations.subject,
      replyDueAt: conversations.replyDueAt,
      lastInboundAt: conversations.lastInboundAt,
      updatedAt: conversations.updatedAt,
      contactId: contacts.id,
      contactName: contacts.fullName,
      preview: sql<string | null>`(select left(m.body, 140) from public.messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(...where))
    // Lo más urgente primero: lo que vence antes; luego lo más reciente.
    .orderBy(sql`${conversations.replyDueAt} asc nulls last`, desc(conversations.updatedAt))
    .limit(opts.limit ?? 100);
  return rows;
}

export type InboxCounts = {
  /** Sin responder que me tocan: mías o sin asignar. Es el número del menú y de Mi día. */
  unansweredMine: number;
  unansweredTeam: number;
  mine: number;
  unassigned: number;
  /** Sin responder por responsable (para la alerta del administrador); null = sin asignar. */
  byAssignee: { assigneeId: string | null; n: number }[];
};

export async function inboxCounts(tx: Tx, userId: string, agencyId: string, now: Date): Promise<InboxCounts> {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const [byAssignee, [mine], [unassigned]] = await Promise.all([
    tx
      .select({ assigneeId: conversations.assigneeId, n: count() })
      .from(conversations)
      .where(and(eq(conversations.agencyId, agencyId), overdue(now)))
      .groupBy(conversations.assigneeId),
    tx
      .select({ n: count() })
      .from(conversations)
      .where(and(eq(conversations.agencyId, agencyId), eq(conversations.assigneeId, userId), sql`${conversations.status} <> 'resuelta'`)),
    tx
      .select({ n: count() })
      .from(conversations)
      .where(and(eq(conversations.agencyId, agencyId), isNull(conversations.assigneeId), sql`${conversations.status} <> 'resuelta'`)),
  ]);
  const team = byAssignee.reduce((a, r) => a + r.n, 0);
  const forMe = byAssignee.filter((r) => r.assigneeId === null || r.assigneeId === userId).reduce((a, r) => a + r.n, 0);
  return { unansweredMine: forMe, unansweredTeam: team, mine: mine.n, unassigned: unassigned.n, byAssignee };
}

export async function getConversation(tx: Tx, userId: string, agencyId: string, id: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  requireIds(id);
  const [conv] = await tx
    .select({ c: conversations, contactName: contacts.fullName, agencyName: agencies.name })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(agencies, eq(agencies.id, conversations.agencyId))
    .where(and(eq(conversations.id, id), eq(conversations.agencyId, agencyId)));
  if (!conv) throw new AppError("not_found");
  const c = conv.c;
  const [msgs, events, phones, emails, consents, opp, openTasks, otherConvs] = await Promise.all([
    tx.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt), asc(messages.id)),
    tx
      .select({ id: activities.id, kind: activities.kind, data: activities.data, actorId: activities.actorId, createdAt: activities.createdAt })
      .from(activities)
      .where(and(eq(activities.contactId, c.contactId), sql`${activities.data} ->> 'conversacion' = ${id}`, sql`${activities.kind} like 'bandeja.%'`))
      .orderBy(asc(activities.createdAt)),
    tx.select({ e164: contactPhones.e164, unverified: contactPhones.unverified }).from(contactPhones).where(eq(contactPhones.contactId, c.contactId)).orderBy(contactPhones.unverified, desc(contactPhones.isPreferred), asc(contactPhones.createdAt)),
    tx.select({ email: contactEmails.email, unverified: contactEmails.unverified }).from(contactEmails).where(eq(contactEmails.contactId, c.contactId)).orderBy(contactEmails.unverified, desc(contactEmails.isPreferred), asc(contactEmails.createdAt)),
    currentConsents(tx, c.contactId),
    c.opportunityId
      ? tx
          .select({ id: opportunities.id, destination: opportunities.destination, ownerId: opportunities.ownerId, stageId: opportunities.stageId, stageName: pipelineStages.name, stageKind: pipelineStages.kind })
          .from(opportunities)
          .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
          .where(eq(opportunities.id, c.opportunityId))
      : Promise.resolve([]),
    c.opportunityId
      ? tx.select({ n: count() }).from(tasks).where(and(eq(tasks.opportunityId, c.opportunityId), eq(tasks.status, "abierta")))
      : tx.select({ n: count() }).from(tasks).where(and(eq(tasks.contactId, c.contactId), eq(tasks.status, "abierta"))),
    tx
      .select({ id: conversations.id, channel: conversations.channel, status: conversations.status, createdAt: conversations.createdAt })
      .from(conversations)
      .where(and(eq(conversations.contactId, c.contactId), sql`${conversations.id} <> ${id}`))
      .orderBy(desc(conversations.createdAt))
      .limit(5),
  ]);
  const withdrawn = (channel: string) => consents.some((x) => x.channel === channel && x.purpose === "servicio" && x.status === "retirado");
  // Para "Vincular a una oportunidad" (parte 2): las abiertas del contacto.
  const linkable = c.opportunityId
    ? []
    : await tx
        .select({ id: opportunities.id, destination: opportunities.destination, stageName: pipelineStages.name, createdAt: opportunities.createdAt })
        .from(opportunities)
        .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
        .where(and(eq(opportunities.contactId, c.contactId), eq(opportunities.agencyId, agencyId), eq(pipelineStages.kind, "abierta")))
        .orderBy(desc(opportunities.updatedAt))
        .limit(20);
  return {
    conversation: c,
    linkableOpportunities: linkable,
    contactName: conv.contactName,
    agencyName: conv.agencyName,
    messages: msgs,
    events,
    phone: phones[0]?.e164 ?? null,
    email: emails[0]?.email ?? null,
    // Lo primero es lo verificado; si lo único que hay está sin verificar, se muestra marcado (D-14).
    phoneUnverified: phones[0]?.unverified ?? false,
    emailUnverified: emails[0]?.unverified ?? false,
    whatsappAllowed: !withdrawn("whatsapp"),
    emailAllowed: !withdrawn("correo"),
    opportunity: opp[0] ?? null,
    openTasks: openTasks[0]?.n ?? 0,
    otherConversations: otherConvs,
  };
}

async function loadForUpdate(tx: Tx, agencyId: string, id: string) {
  requireIds(id);
  const [c] = await tx.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.agencyId, agencyId))).for("update");
  if (!c) throw new AppError("not_found");
  return c;
}

/**
 * Pasa la oportunidad (y el contacto) sin responsable a quien atiende la conversación. Así las
 * tareas automáticas que tenía el administrador por defecto pasan a esa persona (trigger de S02b).
 */
async function carryOwnership(tx: Tx, c: { contactId: string; opportunityId: string | null; assigneeId: string | null }, to: string) {
  if (c.opportunityId) {
    await tx
      .update(opportunities)
      .set({ ownerId: to })
      .where(and(eq(opportunities.id, c.opportunityId), c.assigneeId ? or(isNull(opportunities.ownerId), eq(opportunities.ownerId, c.assigneeId)) : isNull(opportunities.ownerId)));
  }
  await tx.update(contacts).set({ ownerId: to }).where(and(eq(contacts.id, c.contactId), isNull(contacts.ownerId)));
}

/** "Tomar": una conversación sin responsable pasa a quien la toma (RF-263). */
export async function takeConversation(tx: Tx, userId: string, agencyId: string, id: string): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const c = await loadForUpdate(tx, agencyId, id);
  if (c.assigneeId === userId) return;
  if (c.assigneeId) throw new AppError("permission_denied");
  try {
    await tx.update(conversations).set({ assigneeId: userId }).where(eq(conversations.id, id));
    await carryOwnership(tx, c, userId);
  } catch (err) {
    rethrowBusiness(err);
  }
  await logActivity(tx, { agencyId, contactId: c.contactId, opportunityId: c.opportunityId, actorId: userId, kind: "bandeja.tomada", data: { conversacion: id } });
}

/** Reasignar o devolver a la cola: solo el administrador (RF-263). */
export async function assignConversation(tx: Tx, userId: string, agencyId: string, id: string, assigneeId: string | null): Promise<void> {
  await requirePermission(tx, userId, agencyId, "inbox.manage");
  requireIds(assigneeId);
  const c = await loadForUpdate(tx, agencyId, id);
  if (c.assigneeId === assigneeId) return;
  try {
    await tx.update(conversations).set({ assigneeId }).where(eq(conversations.id, id));
    if (assigneeId) await carryOwnership(tx, c, assigneeId);
  } catch (err) {
    rethrowBusiness(err);
  }
  await logActivity(tx, { agencyId, contactId: c.contactId, opportunityId: c.opportunityId, actorId: userId, kind: "bandeja.asignada", data: { conversacion: id, de: c.assigneeId, a: assigneeId } });
  await recordAudit(tx, { agencyId, actorId: userId, action: "conversation.assigned", objectType: "conversation", objectId: id, changes: { from: c.assigneeId, to: assigneeId } });
}

export async function resolveConversation(tx: Tx, userId: string, agencyId: string, id: string): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const c = await loadForUpdate(tx, agencyId, id);
  if (c.status === "resuelta") return;
  try {
    await tx.update(conversations).set({ status: "resuelta" }).where(eq(conversations.id, id));
  } catch (err) {
    rethrowBusiness(err);
  }
  await logActivity(tx, { agencyId, contactId: c.contactId, opportunityId: c.opportunityId, actorId: userId, kind: "bandeja.resuelta", data: { conversacion: id } });
}

export type ReplyVia = "whatsapp" | "correo" | "chat";

/**
 * Responder (RF-266). El formulario se responde por WhatsApp o por correo desde el programa del
 * asesor: el CRM registra la respuesta y devuelve el enlace que abre la app con el texto. El chat
 * se responde en el chat (RF-274): el mensaje aparece en la ventana del visitante y no hay enlace.
 * Si la conversación no tenía responsable, quien responde la toma.
 */
export async function replyConversation(tx: Tx, userId: string, agencyId: string, id: string, input: { body: string; via: ReplyVia }): Promise<{ link: string | null }> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const body = input.body.trim();
  if (!body || body.length > MAX_MESSAGE) throw fieldError("invalid_input", "body");
  if (input.via !== "whatsapp" && input.via !== "correo" && input.via !== "chat") throw new AppError("invalid_input");
  const c = await loadForUpdate(tx, agencyId, id);
  if (input.via === "chat" && c.channel !== "chat") throw new AppError("invalid_input");
  const consents = await currentConsents(tx, c.contactId);
  const withdrawn = (ch: string) => consents.some((x) => x.channel === ch && x.purpose === "servicio" && x.status === "retirado");
  let link: string | null = null;
  if (input.via === "chat") {
    // Responde a quien escribió en la ventana del chat: no depende del teléfono ni del correo.
  } else if (input.via === "whatsapp") {
    const phone = await sendablePhone(tx, agencyId, c.contactId);
    if (withdrawn("whatsapp")) throw new AppError("whatsapp_blocked");
    link = whatsappLink(phone, body);
  } else {
    const email = await sendableEmail(tx, agencyId, c.contactId);
    if (withdrawn("correo")) throw new AppError("email_blocked");
    const [agency] = await tx.select({ name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId));
    link = mailtoLink(email, c.subject ? `Re: ${c.subject}` : `Tu consulta con ${agency?.name ?? "la agencia"}`, body);
  }
  try {
    await tx.insert(messages).values({ agencyId, conversationId: id, direction: "saliente", via: input.via, body, authorId: userId });
    if (!c.assigneeId) {
      await tx.update(conversations).set({ assigneeId: userId }).where(eq(conversations.id, id));
      await carryOwnership(tx, c, userId);
    }
  } catch (err) {
    rethrowBusiness(err);
  }
  await logActivity(tx, { agencyId, contactId: c.contactId, opportunityId: c.opportunityId, actorId: userId, kind: "bandeja.respuesta", data: { conversacion: id, via: input.via } });
  return { link };
}

// ---------------------------------------------------------------------------------------------
// Oportunidad de una conversación (parte 2, RF-275). El chat no la crea solo.

/** "Crear oportunidad": en la primera etapa, origen del canal, responsable el de la conversación. */
export async function createConversationOpportunity(tx: Tx, userId: string, agencyId: string, id: string): Promise<string> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const c = await loadForUpdate(tx, agencyId, id);
  if (c.opportunityId) throw new AppError("conversation_has_opportunity");
  const ownerId = c.assigneeId ?? userId;
  const source = c.channel === "chat" ? "Chat web" : c.channel === "correo" ? "Correo" : "Formulario web";
  const oppId = await createOpportunity(tx, userId, agencyId, { contactId: c.contactId, ownerId, source });
  try {
    await tx.update(conversations).set({ opportunityId: oppId, ...(c.assigneeId ? {} : { assigneeId: userId }) }).where(eq(conversations.id, id));
    if (!c.assigneeId) await carryOwnership(tx, { ...c, opportunityId: oppId }, userId);
  } catch (err) {
    rethrowBusiness(err);
  }
  await logActivity(tx, { agencyId, contactId: c.contactId, opportunityId: oppId, actorId: userId, kind: "bandeja.oportunidad", data: { conversacion: id, oportunidad: oppId, creada: true } });
  return oppId;
}

/** "Vincular a una oportunidad": una abierta del mismo contacto. */
export async function linkConversationOpportunity(tx: Tx, userId: string, agencyId: string, id: string, opportunityId: string): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  requireIds(opportunityId);
  const c = await loadForUpdate(tx, agencyId, id);
  if (c.opportunityId === opportunityId) return;
  if (c.opportunityId) throw new AppError("conversation_has_opportunity");
  const [opp] = await tx
    .select({ id: opportunities.id, contactId: opportunities.contactId, kind: pipelineStages.kind })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.agencyId, agencyId)));
  if (!opp || opp.contactId !== c.contactId) throw new AppError("not_found");
  if (opp.kind !== "abierta") throw new AppError("invalid_input");
  try {
    await tx.update(conversations).set({ opportunityId }).where(eq(conversations.id, id));
  } catch (err) {
    rethrowBusiness(err);
  }
  await logActivity(tx, { agencyId, contactId: c.contactId, opportunityId, actorId: userId, kind: "bandeja.oportunidad", data: { conversacion: id, oportunidad: opportunityId, creada: false } });
}

// ---------------------------------------------------------------------------------------------
// Respuestas guardadas (RF-268, RF-269).

export async function listSavedReplies(tx: Tx, userId: string, agencyId: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  // RLS ya deja solo las de la agencia y las propias; se filtra igual por claridad.
  return tx
    .select()
    .from(savedReplies)
    .where(and(eq(savedReplies.agencyId, agencyId), or(isNull(savedReplies.ownerId), eq(savedReplies.ownerId, userId))))
    .orderBy(sql`${savedReplies.ownerId} is not null`, asc(savedReplies.shortcut));
}

export type SavedReplyInput = { title: string; shortcut: string; body: string; personal: boolean };

function prepareReply(input: SavedReplyInput) {
  const title = input.title.trim();
  if (!title || title.length > 80) throw fieldError("invalid_input", "replyTitle");
  const shortcut = normalizeShortcut(input.shortcut);
  if (!shortcut) throw fieldError("invalid_input", "shortcut");
  const body = input.body.trim();
  if (!body || body.length > 2000) throw fieldError("invalid_input", "replyBody");
  return { title, shortcut, body };
}

function rethrowReply(err: unknown): never {
  const pg = pgError(err);
  if (pg?.code === "23505") throw new AppError("shortcut_taken");
  if (pg?.code === "42501") throw new AppError("permission_denied");
  rethrowBusiness(err);
}

export async function createSavedReply(tx: Tx, userId: string, agencyId: string, input: SavedReplyInput): Promise<string> {
  await requirePermission(tx, userId, agencyId, input.personal ? "crm.write" : "inbox.manage");
  const v = prepareReply(input);
  try {
    const [row] = await tx
      .insert(savedReplies)
      .values({ agencyId, ownerId: input.personal ? userId : null, ...v, createdBy: userId })
      .returning({ id: savedReplies.id });
    if (!input.personal) await recordAudit(tx, { agencyId, actorId: userId, action: "saved_reply.created", objectType: "saved_reply", objectId: row.id, changes: { shortcut: v.shortcut } });
    return row.id;
  } catch (err) {
    rethrowReply(err);
  }
}

async function ownReply(tx: Tx, userId: string, agencyId: string, id: string) {
  requireIds(id);
  const [r] = await tx.select().from(savedReplies).where(and(eq(savedReplies.id, id), eq(savedReplies.agencyId, agencyId)));
  if (!r) throw new AppError("not_found");
  await requirePermission(tx, userId, agencyId, r.ownerId ? "crm.write" : "inbox.manage");
  if (r.ownerId && r.ownerId !== userId) throw new AppError("not_found");
  return r;
}

export async function updateSavedReply(tx: Tx, userId: string, agencyId: string, id: string, input: Omit<SavedReplyInput, "personal">): Promise<void> {
  const r = await ownReply(tx, userId, agencyId, id);
  const v = prepareReply({ ...input, personal: !!r.ownerId });
  try {
    await tx.update(savedReplies).set(v).where(eq(savedReplies.id, id));
  } catch (err) {
    rethrowReply(err);
  }
  if (!r.ownerId) await recordAudit(tx, { agencyId, actorId: userId, action: "saved_reply.updated", objectType: "saved_reply", objectId: id, changes: { shortcut: v.shortcut } });
}

export async function deleteSavedReply(tx: Tx, userId: string, agencyId: string, id: string): Promise<void> {
  const r = await ownReply(tx, userId, agencyId, id);
  await tx.delete(savedReplies).where(eq(savedReplies.id, id));
  if (!r.ownerId) await recordAudit(tx, { agencyId, actorId: userId, action: "saved_reply.deleted", objectType: "saved_reply", objectId: id, changes: { shortcut: r.shortcut } });
}

// ---------------------------------------------------------------------------------------------
// Configuración › Canales (solo administrador).

export async function getInboxSettings(tx: Tx, userId: string, agencyId: string) {
  await requirePermission(tx, userId, agencyId, "inbox.manage");
  const [[settings], channels] = await Promise.all([
    tx.select({ maxMinutes: agencySettings.maxUnansweredMinutes, privacyUrl: agencySettings.privacyUrl }).from(agencySettings).where(eq(agencySettings.agencyId, agencyId)),
    tx.select().from(inboundChannels).where(eq(inboundChannels.agencyId, agencyId)),
  ]);
  return {
    maxMinutes: settings?.maxMinutes ?? 30,
    privacyUrl: settings?.privacyUrl ?? null,
    form: channels.find((c) => c.kind === "formulario") ?? null,
    chat: channels.find((c) => c.kind === "chat") ?? null,
  };
}

export async function updateInboxSettings(tx: Tx, userId: string, agencyId: string, input: { maxMinutes: number; privacyUrl: string | null; formActive: boolean; chatActive?: boolean }): Promise<void> {
  await requirePermission(tx, userId, agencyId, "inbox.manage");
  if (!Number.isInteger(input.maxMinutes) || input.maxMinutes < 5 || input.maxMinutes > 1440) throw fieldError("invalid_input", "maxMinutes");
  const privacyUrl = input.privacyUrl?.trim() || null;
  if (privacyUrl && (!/^https:\/\/\S+$/.test(privacyUrl) || privacyUrl.length > 500)) throw fieldError("invalid_input", "privacyUrl");
  const before = await getInboxSettings(tx, userId, agencyId);
  await tx.insert(agencySettings).values({ agencyId, weekdayStart: "08:00", weekdayEnd: "18:00" }).onConflictDoNothing();
  await tx.update(agencySettings).set({ maxUnansweredMinutes: input.maxMinutes, privacyUrl, updatedAt: new Date() }).where(eq(agencySettings.agencyId, agencyId));
  await tx.update(inboundChannels).set({ active: input.formActive, updatedAt: new Date() }).where(and(eq(inboundChannels.agencyId, agencyId), eq(inboundChannels.kind, "formulario")));
  const chatActive = input.chatActive ?? before.chat?.active ?? false;
  await tx.update(inboundChannels).set({ active: chatActive, updatedAt: new Date() }).where(and(eq(inboundChannels.agencyId, agencyId), eq(inboundChannels.kind, "chat")));
  await recordAudit(tx, {
    agencyId,
    actorId: userId,
    action: "inbox.settings",
    objectType: "agency",
    objectId: agencyId,
    changes: {
      maxMinutes: { from: before.maxMinutes, to: input.maxMinutes },
      privacyUrl: { from: before.privacyUrl, to: privacyUrl },
      formActive: { from: before.form?.active ?? null, to: input.formActive },
      chatActive: { from: before.chat?.active ?? null, to: chatActive },
    },
  });
}

/** Nombres (correo) de los miembros, para mostrar autores y responsables, aunque ya no estén. */
export async function memberEmails(tx: Tx, agencyId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await tx.select({ id: memberships.userId, email: memberships.email }).from(memberships).where(and(eq(memberships.agencyId, agencyId), inArray(memberships.userId, list)));
  return new Map(rows.map((r) => [r.id, r.email]));
}
