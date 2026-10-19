// SPEC-002 · Contactos, duplicados, consentimiento, historial y botón de WhatsApp.
// Todo se ejecuta dentro de withUser: RLS limita a la agencia y aquí se validan permisos y reglas.
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { activities, agencies, contactConsents, contactEmails, contactPhones, contacts, opportunities, pipelineStages, tasks } from "@/db/schema";
import { normalizeEmail } from "@/domain/invitations";
import { normalizePhone } from "@/domain/phone";
import { DEFAULT_WHATSAPP_TEMPLATE, fillWhatsappTemplate, whatsappAllowed, whatsappLink } from "@/domain/whatsapp";
import { recordAudit, requirePermission } from "./agencies";
import { AppError, pgError, rethrowBusiness } from "./errors";

export type Channel = "whatsapp" | "correo" | "telefono";
export type Purpose = "servicio" | "promociones";

export type ContactInput = {
  fullName: string;
  phones: { raw: string; label?: string | null }[];
  emails: string[];
  language?: string | null;
  city?: string | null;
  tags?: string[];
  ownerId?: string | null;
  source?: string | null;
  notes?: string | null;
};

const blank = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
// Dentro de un select, Drizzle escribe las columnas sin tabla; en subconsultas hay que calificarlas.
const CONTACT_ID = sql.raw('"contacts"."id"');

/** Valida y normaliza; el primer teléfono y el primer correo quedan como preferidos. */
export function prepareContact(input: ContactInput) {
  const fullName = input.fullName.trim();
  if (!fullName || fullName.length > 160) throw new AppError("invalid_input");
  const phones: { e164: string; label: string | null }[] = [];
  for (const p of input.phones) {
    if (!p.raw.trim()) continue;
    const e164 = normalizePhone(p.raw);
    if (!e164) throw new AppError("invalid_phone");
    if (!phones.some((x) => x.e164 === e164)) phones.push({ e164, label: blank(p.label) });
  }
  const emails: string[] = [];
  for (const raw of input.emails) {
    if (!raw.trim()) continue;
    const email = normalizeEmail(raw);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("invalid_input");
    if (!emails.includes(email)) emails.push(email);
  }
  const language = blank(input.language)?.toLowerCase() ?? null;
  if (language && !/^[a-z]{2}$/.test(language)) throw new AppError("invalid_input");
  const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  return {
    fullName,
    phones,
    emails,
    language,
    city: blank(input.city),
    tags,
    ownerId: input.ownerId ?? null,
    source: blank(input.source),
    notes: blank(input.notes),
  };
}

/** Contacto de la agencia que ya usa alguno de esos teléfonos o correos (RF-204). */
export async function findDuplicate(tx: Tx, agencyId: string, phones: string[], emails: string[], exceptId?: string): Promise<string | null> {
  if (phones.length) {
    const [p] = await tx
      .select({ id: contactPhones.contactId })
      .from(contactPhones)
      .where(and(eq(contactPhones.agencyId, agencyId), inArray(contactPhones.e164, phones), exceptId ? ne(contactPhones.contactId, exceptId) : undefined))
      .limit(1);
    if (p) return p.id;
  }
  if (emails.length) {
    const [e] = await tx
      .select({ id: contactEmails.contactId })
      .from(contactEmails)
      .where(and(eq(contactEmails.agencyId, agencyId), inArray(contactEmails.email, emails), exceptId ? ne(contactEmails.contactId, exceptId) : undefined))
      .limit(1);
    if (e) return e.id;
  }
  return null;
}

async function writeIdentifiers(tx: Tx, agencyId: string, contactId: string, data: ReturnType<typeof prepareContact>) {
  await tx.delete(contactPhones).where(and(eq(contactPhones.contactId, contactId), eq(contactPhones.agencyId, agencyId)));
  await tx.delete(contactEmails).where(and(eq(contactEmails.contactId, contactId), eq(contactEmails.agencyId, agencyId)));
  try {
    if (data.phones.length) {
      await tx.insert(contactPhones).values(data.phones.map((p, i) => ({ agencyId, contactId, e164: p.e164, label: p.label, isPreferred: i === 0 })));
    }
    if (data.emails.length) {
      await tx.insert(contactEmails).values(data.emails.map((email, i) => ({ agencyId, contactId, email, isPreferred: i === 0 })));
    }
  } catch (err) {
    // Otro asesor guardó el mismo dato al mismo tiempo: la restricción única decide.
    if (pgError(err)?.code === "23505") throw new AppError("duplicate_contact");
    throw err;
  }
}

export async function createContact(tx: Tx, userId: string, agencyId: string, input: ContactInput): Promise<string> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const data = prepareContact(input);
  const dup = await findDuplicate(tx, agencyId, data.phones.map((p) => p.e164), data.emails);
  if (dup) throw new AppError("duplicate_contact", dup);
  try {
    const [row] = await tx
      .insert(contacts)
      .values({ agencyId, fullName: data.fullName, language: data.language, city: data.city, tags: data.tags, ownerId: data.ownerId ?? userId, source: data.source, notes: data.notes, createdBy: userId })
      .returning({ id: contacts.id });
    await writeIdentifiers(tx, agencyId, row.id, data);
    await logActivity(tx, { agencyId, contactId: row.id, actorId: userId, kind: "contacto.creado", data: { nombre: data.fullName } });
    await recordAudit(tx, { agencyId, actorId: userId, action: "contact.created", objectType: "contact", objectId: row.id, changes: { fullName: data.fullName } });
    return row.id;
  } catch (err) {
    if (err instanceof AppError) throw err;
    rethrowBusiness(err);
  }
}

export async function updateContact(tx: Tx, userId: string, agencyId: string, contactId: string, input: ContactInput): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const data = prepareContact(input);
  const dup = await findDuplicate(tx, agencyId, data.phones.map((p) => p.e164), data.emails, contactId);
  if (dup) throw new AppError("duplicate_contact", dup);
  const [before] = await tx.select({ ownerId: contacts.ownerId }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.agencyId, agencyId)));
  if (!before) throw new AppError("not_found");
  try {
    await tx
      .update(contacts)
      .set({ fullName: data.fullName, language: data.language, city: data.city, tags: data.tags, ownerId: data.ownerId, source: data.source, notes: data.notes })
      .where(and(eq(contacts.id, contactId), eq(contacts.agencyId, agencyId)));
  } catch (err) {
    rethrowBusiness(err);
  }
  await writeIdentifiers(tx, agencyId, contactId, data);
  if (before.ownerId !== data.ownerId) {
    await logActivity(tx, { agencyId, contactId, actorId: userId, kind: "contacto.responsable", data: { de: before.ownerId, a: data.ownerId } });
  }
  await recordAudit(tx, { agencyId, actorId: userId, action: "contact.updated", objectType: "contact", objectId: contactId, changes: { fullName: data.fullName, ownerId: data.ownerId } });
}

export async function listContacts(tx: Tx, userId: string, agencyId: string, q = "", limit = 100) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const term = q.trim();
  const phone = term ? normalizePhone(term) : null;
  const search = term
    ? or(
        ilike(contacts.fullName, `%${term.replace(/[%_\\]/g, "\\$&")}%`),
        sql`exists (select 1 from ${contactEmails} e where e.contact_id = ${contacts.id} and e.email like ${`%${term.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`})`,
        phone ? sql`exists (select 1 from ${contactPhones} p where p.contact_id = ${contacts.id} and p.e164 = ${phone})` : undefined,
      )
    : undefined;
  return tx
    .select({
      id: contacts.id,
      fullName: contacts.fullName,
      ownerId: contacts.ownerId,
      tags: contacts.tags,
      createdAt: contacts.createdAt,
      phone: sql<string | null>`(select p.e164 from ${contactPhones} p where p.contact_id = ${CONTACT_ID} and p.is_preferred limit 1)`,
      email: sql<string | null>`(select e.email from ${contactEmails} e where e.contact_id = ${CONTACT_ID} and e.is_preferred limit 1)`,
      openOpportunities: sql<number>`(select count(*)::int from ${opportunities} o join ${pipelineStages} s on s.id = o.stage_id where o.contact_id = ${CONTACT_ID} and s.kind = 'abierta')`,
    })
    .from(contacts)
    .where(and(eq(contacts.agencyId, agencyId), search))
    .orderBy(desc(contacts.createdAt))
    .limit(limit);
}

/** Último registro por canal y finalidad: ese es el consentimiento vigente. */
export async function currentConsents(tx: Tx, contactId: string) {
  const rows = await tx
    .selectDistinctOn([contactConsents.channel, contactConsents.purpose], {
      channel: contactConsents.channel,
      purpose: contactConsents.purpose,
      status: contactConsents.status,
      source: contactConsents.source,
      createdAt: contactConsents.createdAt,
    })
    .from(contactConsents)
    .where(eq(contactConsents.contactId, contactId))
    .orderBy(contactConsents.channel, contactConsents.purpose, desc(contactConsents.createdAt), desc(contactConsents.id));
  return rows;
}

export async function getContactDetail(tx: Tx, userId: string, agencyId: string, contactId: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const [contact] = await tx.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.agencyId, agencyId)));
  if (!contact) throw new AppError("not_found");
  const [phones, emails, consents, opps, openTasks, history] = await Promise.all([
    tx.select().from(contactPhones).where(eq(contactPhones.contactId, contactId)).orderBy(desc(contactPhones.isPreferred), contactPhones.createdAt),
    tx.select().from(contactEmails).where(eq(contactEmails.contactId, contactId)).orderBy(desc(contactEmails.isPreferred), contactEmails.createdAt),
    currentConsents(tx, contactId),
    tx
      .select({ id: opportunities.id, destination: opportunities.destination, stageName: pipelineStages.name, stageKind: pipelineStages.kind, ownerId: opportunities.ownerId, updatedAt: opportunities.updatedAt })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(eq(opportunities.contactId, contactId))
      .orderBy(desc(opportunities.updatedAt)),
    tx.select().from(tasks).where(and(eq(tasks.contactId, contactId), eq(tasks.status, "abierta"))).orderBy(tasks.dueAt),
    tx.select().from(activities).where(eq(activities.contactId, contactId)).orderBy(desc(activities.createdAt)).limit(100),
  ]);
  return { contact, phones, emails, consents, opportunities: opps, openTasks, history };
}

export async function recordConsent(
  tx: Tx,
  userId: string,
  agencyId: string,
  contactId: string,
  input: { channel: Channel; purpose: Purpose; status: "otorgado" | "retirado"; source: string },
): Promise<void> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const source = input.source.trim();
  if (!source) throw new AppError("invalid_input");
  const [c] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.agencyId, agencyId)));
  if (!c) throw new AppError("not_found");
  await tx.insert(contactConsents).values({ agencyId, contactId, channel: input.channel, purpose: input.purpose, status: input.status, source, actorId: userId });
  await logActivity(tx, { agencyId, contactId, actorId: userId, kind: "consentimiento.cambiado", data: { ...input, source } });
  await recordAudit(tx, { agencyId, actorId: userId, action: "consent.recorded", objectType: "contact", objectId: contactId, changes: { ...input, source } });
}

/** Mensaje prellenado para el botón de WhatsApp de la ficha. */
export async function whatsappDraft(tx: Tx, agencyId: string, contactId: string, opportunityId?: string | null) {
  const [c] = await tx.select({ fullName: contacts.fullName }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.agencyId, agencyId)));
  if (!c) throw new AppError("not_found");
  const [a] = await tx.select({ name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId));
  let destination: string | null = null;
  if (opportunityId) {
    const [o] = await tx.select({ destination: opportunities.destination }).from(opportunities).where(and(eq(opportunities.id, opportunityId), eq(opportunities.contactId, contactId)));
    destination = o?.destination ?? null;
  }
  return fillWhatsappTemplate(DEFAULT_WHATSAPP_TEMPLATE, { nombre: c.fullName, agencia: a?.name ?? "", destino: destination });
}

/** Registra que el asesor abrió WhatsApp y devuelve el enlace (RF-212, RF-213). No envía nada. */
export async function openWhatsapp(
  tx: Tx,
  userId: string,
  agencyId: string,
  contactId: string,
  input: { message: string; opportunityId?: string | null },
): Promise<string> {
  await requirePermission(tx, userId, agencyId, "crm.write");
  const message = input.message.trim();
  if (!message || message.length > 2000) throw new AppError("invalid_input");
  const [phone] = await tx
    .select({ e164: contactPhones.e164 })
    .from(contactPhones)
    .where(and(eq(contactPhones.contactId, contactId), eq(contactPhones.agencyId, agencyId)))
    .orderBy(desc(contactPhones.isPreferred), contactPhones.createdAt)
    .limit(1);
  if (!phone) {
    const [c] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.agencyId, agencyId)));
    throw new AppError(c ? "no_phone" : "not_found");
  }
  if (!whatsappAllowed(await currentConsents(tx, contactId))) throw new AppError("whatsapp_blocked");
  await logActivity(tx, { agencyId, contactId, opportunityId: input.opportunityId ?? null, actorId: userId, kind: "whatsapp.abierto", data: { telefono: phone.e164, mensaje: message } });
  await recordAudit(tx, { agencyId, actorId: userId, action: "whatsapp.opened", objectType: "contact", objectId: contactId, changes: { phone: phone.e164 } });
  return whatsappLink(phone.e164, message);
}

export async function logActivity(
  tx: Tx,
  a: { agencyId: string; contactId: string; opportunityId?: string | null; actorId: string; kind: string; data?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(activities).values({ agencyId: a.agencyId, contactId: a.contactId, opportunityId: a.opportunityId ?? null, actorId: a.actorId, kind: a.kind, data: a.data ?? {} });
}
