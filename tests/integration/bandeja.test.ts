// SPEC-003 · Bandeja unificada (parte 1) contra PostgreSQL real: formulario público, responsable,
// estados, sin responder en horario laboral, respuestas y respuestas guardadas, con aislamiento.
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { withAnon, type SessionUser } from "../../src/db/client";
import { contactConsents, contactEmails, contactPhones, conversations, inboundChannels, messages, opportunities, savedReplies, tasks } from "../../src/db/schema";
import type { WebFormData } from "../../src/domain/inbox";
import { acceptInvitation, createAgency, createInvitation } from "../../src/server/agencies";
import { createContact, getContactDetail, listContacts, openWhatsapp, recordConsent, updateContact, verifyContactPoint } from "../../src/server/contacts";
import { contactChannels, openTaskLink } from "../../src/server/tasks";
import { AppError, pgError } from "../../src/server/errors";
import {
  assignConversation,
  createSavedReply,
  deleteSavedReply,
  getConversation,
  getInboxSettings,
  inboxCounts,
  listConversations,
  listSavedReplies,
  replyConversation,
  resolveConversation,
  takeConversation,
  updateInboxSettings,
  updateSavedReply,
} from "../../src/server/inbox";
import { createOpportunity } from "../../src/server/opportunities";
import { submitWebForm, webFormInfo } from "../../src/server/public-form";
import { as, createUser, testDb } from "./helpers";

const t = testDb();
afterAll(() => t.close());

type Agency = { id: string; key: string; admin: SessionUser; ana: SessionUser; luis: SessionUser; lectura: SessionUser };

async function newAgency(name: string): Promise<Agency> {
  const admin = await createUser(t.admin, "adm");
  const ana = await createUser(t.admin, "ana");
  const luis = await createUser(t.admin, "luis");
  const lectura = await createUser(t.admin, "lec");
  const id = await as(t.db, admin, (tx) => createAgency(tx, `${name} ${admin.id.slice(0, 6)}`));
  for (const [who, role] of [[ana, "asesor"], [luis, "asesor"], [lectura, "lectura"]] as const) {
    const inv = await as(t.db, admin, (tx) => createInvitation(tx, { userId: admin.id, agencyId: id, email: who.email, role, now: new Date() }));
    await as(t.db, who, (tx) => acceptInvitation(tx, inv.token));
  }
  const [ch] = await t.db.select().from(inboundChannels).where(and(eq(inboundChannels.agencyId, id), eq(inboundChannels.kind, "formulario")));
  return { id, key: ch.publicKey, admin, ana, luis, lectura };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function expectDb(p: Promise<unknown>, text: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => {
    const pg = pgError(e);
    return pg?.message === text || pg?.code === text || (pg?.message ?? "").includes(text);
  });
}

let ipSeq = 0;
const form = (over: Partial<WebFormData> = {}): WebFormData => ({
  name: "María Prueba",
  phone: `+57300${String(1000000 + Math.floor(Math.random() * 8999999))}`,
  email: null,
  destination: "Cartagena",
  dates: "Semana Santa",
  travelers: 4,
  message: "¿Tienen paquetes?",
  ...over,
});
const submit = (a: Agency, data: WebFormData, ip = `10.0.0.${++ipSeq}`) => withAnon(t.db, (tx) => submitWebForm(tx, a.key, data, ip));

/** Pone el plazo de respuesta en el pasado, como si hubiera pasado el tiempo máximo. */
async function expire(convId: string) {
  await t.admin`update public.conversations set reply_due_at = now() - interval '1 minute' where id = ${convId}`;
}

describe("formulario web (RF-260, RF-261, RF-271, AC-261, AC-273)", () => {
  it("crea contacto, oportunidad, conversación, mensaje, consentimientos y tareas automáticas", async () => {
    const a = await newAgency("Bandeja A");
    const info = await withAnon(t.db, (tx) => webFormInfo(tx, a.key));
    expect(info).toMatchObject({ active: true });
    const convId = await submit(a, form({ email: "maria@example.com" }));
    const c = await as(t.db, a.admin, (tx) => getConversation(tx, a.admin.id, a.id, convId));
    expect(c.conversation).toMatchObject({ channel: "formulario", status: "abierta", assigneeId: null });
    expect(c.conversation.replyDueAt).not.toBeNull();
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]).toMatchObject({ direction: "entrante", via: "formulario" });
    expect(c.messages[0].body).toContain("Destino: Cartagena");
    expect(c.opportunity?.destination).toBe("Cartagena");
    const [opp] = await t.db.select().from(opportunities).where(eq(opportunities.id, c.conversation.opportunityId!));
    expect(opp).toMatchObject({ source: "Formulario web", travelers: 4, ownerId: null });
    // Plantilla "oportunidad nueva" de S02b: 4 tareas para el administrador mientras nadie la toma.
    const ts = await t.db.select().from(tasks).where(eq(tasks.opportunityId, opp.id));
    expect(ts).toHaveLength(4);
    expect(ts.every((x) => x.assigneeId === a.admin.id)).toBe(true);
    const consents = await t.db.select().from(contactConsents).where(eq(contactConsents.contactId, c.conversation.contactId));
    expect(consents.map((x) => x.channel).sort()).toEqual(["correo", "telefono", "whatsapp"]);
    expect(consents.every((x) => x.status === "otorgado" && x.source.includes("aviso de privacidad"))).toBe(true);
  });

  it("AC-261: un contacto existente con ese teléfono recibe una segunda oportunidad, que va a su asesor", async () => {
    const a = await newAgency("Bandeja dup");
    const contactId = await as(t.db, a.luis, (tx) => createContact(tx, a.luis.id, a.id, { fullName: "Pedro", phones: [{ raw: "+57 300 000 0000" }], emails: [] }));
    const first = await as(t.db, a.luis, (tx) => createOpportunity(tx, a.luis.id, a.id, { contactId, destination: "Cancún", ownerId: a.luis.id }));
    const convId = await submit(a, form({ phone: "+573000000000", destination: "Madrid" }));
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv.contactId).toBe(contactId);
    expect(conv.opportunityId).not.toBe(first);
    // AC-264 (por formulario): el contacto con oportunidad abierta de Luis queda con Luis.
    expect(conv.assigneeId).toBe(a.luis.id);
    const opps = await t.db.select().from(opportunities).where(eq(opportunities.contactId, contactId));
    expect(opps).toHaveLength(2);
    expect(opps.find((o) => o.id === conv.opportunityId)?.ownerId).toBe(a.luis.id);
  });

  it("AC-262: la agencia sale del código del formulario; un formulario pausado o inexistente rechaza", async () => {
    const a = await newAgency("Bandeja cod A");
    const b = await newAgency("Bandeja cod B");
    const convId = await submit(a, form());
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv.agencyId).toBe(a.id);
    expect(await as(t.db, b.admin, (tx) => listConversations(tx, b.admin.id, b.id, { filter: "todas", now: new Date() }))).toHaveLength(0);
    await as(t.db, a.admin, (tx) => updateInboxSettings(tx, a.admin.id, a.id, { maxMinutes: 30, privacyUrl: null, formActive: false }));
    await expectCode(submit(a, form()), "channel_closed");
    await expectCode(withAnon(t.db, (tx) => submitWebForm(tx, "f".repeat(32), form(), "1.1.1.1")), "channel_closed");
    await expectCode(withAnon(t.db, (tx) => submitWebForm(tx, "no-es-un-codigo", form(), "1.1.1.1")), "channel_closed");
  });

  it("AC-274: más de 5 envíos en 10 minutos desde la misma dirección no crean conversaciones", async () => {
    const a = await newAgency("Bandeja spam");
    for (let i = 0; i < 5; i++) await submit(a, form(), "9.9.9.9");
    await expectCode(submit(a, form(), "9.9.9.9"), "rate_limited");
    const all = await t.db.select().from(conversations).where(eq(conversations.agencyId, a.id));
    expect(all).toHaveLength(5);
    // Otra dirección sí puede.
    await submit(a, form(), "9.9.9.10");
  });

  it("el rol anon no lee tablas ni llama funciones internas", async () => {
    const a = await newAgency("Bandeja anon");
    await expectDb(withAnon(t.db, (tx) => tx.select().from(conversations)), "42501");
    await expectDb(withAnon(t.db, (tx) => tx.select().from(inboundChannels)), "42501");
    await expectDb(withAnon(t.db, (tx) => tx.execute(sql`select app.seed_inbox(${a.id}, ${a.admin.id})`)), "42501");
    await expectDb(withAnon(t.db, (tx) => tx.execute(sql`select app.inbound_hit('x', 1)`)), "42501");
  });
});

describe("responsable y estados (RF-263, RF-264, AC-263, AC-265)", () => {
  it("AC-263: sin asignar → Ana toma → queda en Mías de Ana con historial; las tareas pasan a Ana", async () => {
    const a = await newAgency("Bandeja tomar");
    const convId = await submit(a, form());
    const now = new Date();
    expect((await as(t.db, a.ana, (tx) => listConversations(tx, a.ana.id, a.id, { filter: "sin_asignar", now }))).map((r) => r.id)).toEqual([convId]);
    await as(t.db, a.ana, (tx) => takeConversation(tx, a.ana.id, a.id, convId));
    expect((await as(t.db, a.ana, (tx) => listConversations(tx, a.ana.id, a.id, { filter: "mias", now }))).map((r) => r.id)).toEqual([convId]);
    expect(await as(t.db, a.ana, (tx) => listConversations(tx, a.ana.id, a.id, { filter: "sin_asignar", now }))).toHaveLength(0);
    const c = await as(t.db, a.ana, (tx) => getConversation(tx, a.ana.id, a.id, convId));
    expect(c.events.map((e) => e.kind)).toContain("bandeja.tomada");
    const [opp] = await t.db.select().from(opportunities).where(eq(opportunities.id, c.conversation.opportunityId!));
    expect(opp.ownerId).toBe(a.ana.id);
    const ts = await t.db.select().from(tasks).where(and(eq(tasks.opportunityId, opp.id), eq(tasks.status, "abierta")));
    expect(ts.every((x) => x.assigneeId === a.ana.id)).toBe(true);
    // Luis no puede quitársela; el administrador sí la reasigna.
    await expectCode(as(t.db, a.luis, (tx) => takeConversation(tx, a.luis.id, a.id, convId)), "permission_denied");
    await expectCode(as(t.db, a.luis, (tx) => assignConversation(tx, a.luis.id, a.id, convId, a.luis.id)), "permission_denied");
    await expectDb(as(t.db, a.luis, (tx) => tx.update(conversations).set({ assigneeId: a.luis.id }).where(eq(conversations.id, convId))), "permission_denied");
    await as(t.db, a.admin, (tx) => assignConversation(tx, a.admin.id, a.id, convId, a.luis.id));
    const [after] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(after.assigneeId).toBe(a.luis.id);
  });

  it("AC-265: responder deja pendiente; un mensaje nuevo del cliente la reabre, también si estaba resuelta", async () => {
    const a = await newAgency("Bandeja estados");
    const data = form({ email: "cliente@example.com" });
    const convId = await submit(a, data);
    const r = await as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, convId, { body: "Hola María", via: "whatsapp" }));
    expect(r.link).toMatch(/^https:\/\/wa\.me\/57300\d+\?text=Hola%20Mar%C3%ADa$/);
    let [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv).toMatchObject({ status: "pendiente", replyDueAt: null, assigneeId: a.ana.id });
    // El cliente vuelve a escribir (simulado como lo hará el chat o el correo).
    await t.admin`insert into public.messages (agency_id, conversation_id, direction, via, body) values (${a.id}, ${convId}, 'entrante', 'formulario', 'Una pregunta más')`;
    [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv.status).toBe("abierta");
    expect(conv.replyDueAt).not.toBeNull();
    await as(t.db, a.ana, (tx) => resolveConversation(tx, a.ana.id, a.id, convId));
    [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv).toMatchObject({ status: "resuelta", replyDueAt: null });
    await t.admin`insert into public.messages (agency_id, conversation_id, direction, via, body) values (${a.id}, ${convId}, 'entrante', 'formulario', 'Volví')`;
    [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv.status).toBe("abierta");
    // Un usuario no puede reabrir ni marcar pendiente a mano.
    await expectDb(as(t.db, a.ana, (tx) => tx.update(conversations).set({ status: "pendiente" }).where(eq(conversations.id, convId))), "invalid_input");
  });
});

describe("sin responder en horario laboral (RF-265, AC-266, AC-267, AC-275)", () => {
  const deadline = async (agencyId: string, from: string, minutes = 30) =>
    (await t.admin<{ d: Date }[]>`select app.business_deadline(${from}::timestamptz, ${minutes}, ${agencyId}) as d`)[0].d.toISOString();

  it("AC-266: martes 10:00 con 30 minutos vence a las 10:30", async () => {
    const a = await newAgency("Bandeja reloj");
    // 2026-11-03 es martes; 10:00 en Bogotá = 15:00 UTC.
    expect(await deadline(a.id, "2026-11-03T10:00:00-05:00")).toBe("2026-11-03T15:30:00.000Z");
  });

  it("AC-267: viernes 22:00 vence el sábado 8:30; sábado 11:45 vence el lunes 8:15", async () => {
    const a = await newAgency("Bandeja reloj 2");
    expect(await deadline(a.id, "2026-11-06T22:00:00-05:00")).toBe("2026-11-07T13:30:00.000Z");
    expect(await deadline(a.id, "2026-11-07T11:45:00-05:00")).toBe("2026-11-09T13:15:00.000Z");
  });

  it("aparece como sin responder al vencer; el número cuenta las mías y las sin asignar, y el admin ve las del equipo", async () => {
    const a = await newAgency("Bandeja alerta");
    const c1 = await submit(a, form());
    const c2 = await submit(a, form());
    const c3 = await submit(a, form());
    await as(t.db, a.luis, (tx) => takeConversation(tx, a.luis.id, a.id, c3));
    const now = new Date();
    // Recién llegadas: dentro del plazo.
    expect(await as(t.db, a.ana, (tx) => listConversations(tx, a.ana.id, a.id, { filter: "sin_responder", now }))).toHaveLength(0);
    for (const c of [c1, c2, c3]) await expire(c);
    const ana = await as(t.db, a.ana, (tx) => inboxCounts(tx, a.ana.id, a.id, new Date()));
    expect(ana).toMatchObject({ unansweredMine: 2, unansweredTeam: 3, unassigned: 2 });
    const admin = await as(t.db, a.admin, (tx) => inboxCounts(tx, a.admin.id, a.id, new Date()));
    expect(admin.unansweredTeam).toBe(3);
    expect(admin.byAssignee).toEqual(expect.arrayContaining([{ assigneeId: null, n: 2 }, { assigneeId: a.luis.id, n: 1 }]));
    expect((await as(t.db, a.ana, (tx) => listConversations(tx, a.ana.id, a.id, { filter: "sin_responder", now: new Date() }))).map((r) => r.id).sort()).toEqual([c1, c2, c3].sort());
    // AC-275: al responder, deja de contar.
    await as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, c1, { body: "Hola", via: "whatsapp" }));
    await as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, c2, { body: "Hola", via: "whatsapp" }));
    expect((await as(t.db, a.ana, (tx) => inboxCounts(tx, a.ana.id, a.id, new Date()))).unansweredMine).toBe(0);
  });

  it("el tiempo máximo de la agencia se usa para los mensajes nuevos", async () => {
    const a = await newAgency("Bandeja minutos");
    await as(t.db, a.admin, (tx) => updateInboxSettings(tx, a.admin.id, a.id, { maxMinutes: 120, privacyUrl: "https://agencia.example.com/privacidad", formActive: true }));
    const s = await as(t.db, a.admin, (tx) => getInboxSettings(tx, a.admin.id, a.id));
    expect(s).toMatchObject({ maxMinutes: 120, privacyUrl: "https://agencia.example.com/privacidad" });
    expect((await withAnon(t.db, (tx) => webFormInfo(tx, a.key)))?.privacyUrl).toBe("https://agencia.example.com/privacidad");
    await expectCode(as(t.db, a.admin, (tx) => updateInboxSettings(tx, a.admin.id, a.id, { maxMinutes: 2, privacyUrl: null, formActive: true })), "invalid_input");
    await expectCode(as(t.db, a.ana, (tx) => updateInboxSettings(tx, a.ana.id, a.id, { maxMinutes: 60, privacyUrl: null, formActive: true })), "permission_denied");
  });
});

describe("responder (RF-266, AC-268) y permisos (RF-267, AC-269)", () => {
  it("AC-268: la respuesta queda con autor, hora y canal", async () => {
    const a = await newAgency("Bandeja autor");
    const convId = await submit(a, form({ email: "m@example.com" }));
    const r = await as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, convId, { body: "Te escribo por correo", via: "correo" }));
    expect(r.link).toMatch(/^mailto:m@example\.com\?subject=Re%3A%20Formulario%20web/);
    const [out] = await t.db.select().from(messages).where(and(eq(messages.conversationId, convId), eq(messages.direction, "saliente")));
    expect(out).toMatchObject({ authorId: a.ana.id, via: "correo", body: "Te escribo por correo" });
    expect(out.createdAt).toBeInstanceOf(Date);
  });

  it("respeta el permiso retirado y la falta de teléfono o correo", async () => {
    const a = await newAgency("Bandeja permisos canal");
    const convId = await submit(a, form());
    await expectCode(as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, convId, { body: "Hola", via: "correo" })), "no_email");
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    await as(t.db, a.ana, (tx) => recordConsent(tx, a.ana.id, a.id, conv.contactId, { channel: "whatsapp", purpose: "servicio", status: "retirado", source: "Pidió no más WhatsApp" }));
    await expectCode(as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, convId, { body: "Hola", via: "whatsapp" })), "whatsapp_blocked");
    await expectCode(as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, convId, { body: "  ", via: "whatsapp" })), "invalid_input");
  });

  it("AC-269: Lectura no responde, no toma ni resuelve (servidor y base); otra agencia no ve nada", async () => {
    const a = await newAgency("Bandeja lectura");
    const b = await newAgency("Bandeja lectura B");
    const convId = await submit(a, form());
    const L = a.lectura;
    expect(await as(t.db, L, (tx) => listConversations(tx, L.id, a.id, { filter: "todas", now: new Date() }))).toHaveLength(1);
    await expectCode(as(t.db, L, (tx) => replyConversation(tx, L.id, a.id, convId, { body: "x", via: "whatsapp" })), "permission_denied");
    await expectCode(as(t.db, L, (tx) => takeConversation(tx, L.id, a.id, convId)), "permission_denied");
    await expectCode(as(t.db, L, (tx) => resolveConversation(tx, L.id, a.id, convId)), "permission_denied");
    await expectDb(as(t.db, L, (tx) => tx.insert(messages).values({ agencyId: a.id, conversationId: convId, direction: "saliente", via: "whatsapp", body: "x", authorId: L.id })), "row-level security");
    const upd = await as(t.db, L, (tx) => tx.update(conversations).set({ status: "resuelta" }).where(eq(conversations.id, convId)).returning());
    expect(upd).toHaveLength(0);
    // Agencia B: ni por el servidor ni directo en la base.
    await expectCode(as(t.db, b.admin, (tx) => getConversation(tx, b.admin.id, b.id, convId)), "not_found");
    expect(await as(t.db, b.admin, (tx) => tx.select().from(conversations).where(eq(conversations.agencyId, a.id)))).toHaveLength(0);
    expect(await as(t.db, b.admin, (tx) => tx.select().from(messages).where(eq(messages.agencyId, a.id)))).toHaveLength(0);
    await expectDb(
      as(t.db, b.admin, (tx) => tx.insert(messages).values({ agencyId: a.id, conversationId: convId, direction: "saliente", via: "whatsapp", body: "x", authorId: b.admin.id })),
      "row-level security",
    );
    // Un asesor no puede fingir un mensaje entrante.
    await expectDb(
      as(t.db, a.ana, (tx) => tx.insert(messages).values({ agencyId: a.id, conversationId: convId, direction: "entrante", via: "formulario", body: "falso", authorId: a.ana.id })),
      "row-level security",
    );
  });
});

describe("respuestas guardadas (RF-268, AC-270)", () => {
  it("vienen 5 de ejemplo; el asesor no cambia las de la agencia y sus personales no las ve otro asesor", async () => {
    const a = await newAgency("Bandeja respuestas");
    const b = await newAgency("Bandeja respuestas B");
    const list = await as(t.db, a.ana, (tx) => listSavedReplies(tx, a.ana.id, a.id));
    expect(list.map((r) => r.shortcut).sort()).toEqual(["datos", "documentos", "horario", "pagos", "saludo"]);
    const agencyReply = list[0];
    await expectCode(as(t.db, a.ana, (tx) => createSavedReply(tx, a.ana.id, a.id, { title: "X", shortcut: "x", body: "x", personal: false })), "permission_denied");
    await expectCode(as(t.db, a.ana, (tx) => updateSavedReply(tx, a.ana.id, a.id, agencyReply.id, { title: "X", shortcut: "x", body: "x" })), "permission_denied");
    const upd = await as(t.db, a.ana, (tx) => tx.update(savedReplies).set({ body: "hackeado" }).where(eq(savedReplies.id, agencyReply.id)).returning());
    expect(upd).toHaveLength(0);
    const mine = await as(t.db, a.ana, (tx) => createSavedReply(tx, a.ana.id, a.id, { title: "Mi saludo", shortcut: "/Hola", body: "Hola {nombre}", personal: true }));
    expect((await as(t.db, a.ana, (tx) => listSavedReplies(tx, a.ana.id, a.id))).find((r) => r.id === mine)?.shortcut).toBe("hola");
    expect((await as(t.db, a.luis, (tx) => listSavedReplies(tx, a.luis.id, a.id))).some((r) => r.id === mine)).toBe(false);
    expect(await as(t.db, a.luis, (tx) => tx.select().from(savedReplies).where(eq(savedReplies.id, mine)))).toHaveLength(0);
    await expectCode(as(t.db, a.luis, (tx) => deleteSavedReply(tx, a.luis.id, a.id, mine)), "not_found");
    // Lectura no crea ni personales.
    await expectCode(as(t.db, a.lectura, (tx) => createSavedReply(tx, a.lectura.id, a.id, { title: "X", shortcut: "y", body: "x", personal: true })), "permission_denied");
    // Atajo repetido y validaciones.
    await expectCode(as(t.db, a.ana, (tx) => createSavedReply(tx, a.ana.id, a.id, { title: "Otro", shortcut: "hola", body: "x", personal: true })), "shortcut_taken");
    await expectCode(as(t.db, a.ana, (tx) => createSavedReply(tx, a.ana.id, a.id, { title: "Otro", shortcut: "con espacio", body: "x", personal: true })), "invalid_input");
    // El administrador edita y borra las de la agencia; otra agencia no las ve.
    await as(t.db, a.admin, (tx) => updateSavedReply(tx, a.admin.id, a.id, agencyReply.id, { title: "Nuevo", shortcut: agencyReply.shortcut, body: "Texto nuevo" }));
    await as(t.db, a.admin, (tx) => deleteSavedReply(tx, a.admin.id, a.id, agencyReply.id));
    expect(await as(t.db, b.admin, (tx) => tx.select().from(savedReplies).where(eq(savedReplies.agencyId, a.id)))).toHaveLength(0);
    await as(t.db, a.ana, (tx) => deleteSavedReply(tx, a.ana.id, a.id, mine));
  });
});

describe("contacto existente por teléfono", () => {
  it("no duplica el teléfono del contacto", async () => {
    const a = await newAgency("Bandeja tel");
    await submit(a, form({ phone: "+573001112233" }));
    await submit(a, form({ phone: "+573001112233", name: "Otro nombre" }));
    const phones = await t.db.select().from(contactPhones).where(and(eq(contactPhones.agencyId, a.id), eq(contactPhones.e164, "+573001112233")));
    expect(phones).toHaveLength(1);
  });
});

describe("prueba independiente (T-069)", () => {
  it("H-1: el formulario rechaza un correo con ? o & que alteraría el enlace mailto", async () => {
    const a = await newAgency("Bandeja H1");
    await expectCode(submit(a, form({ phone: null, email: "a@b.co?bcc=otro%40x.com&subject=hola" })), "invalid_input");
  });

  it("H-2: un formulario nuevo no vuelve a otorgar un permiso que el contacto retiró", async () => {
    const a = await newAgency("Bandeja H2");
    const phone = "+573009998877";
    const convId = await submit(a, form({ phone }));
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    await as(t.db, a.ana, (tx) => recordConsent(tx, a.ana.id, a.id, conv.contactId, { channel: "whatsapp", purpose: "servicio", status: "retirado", source: "Pidió no más WhatsApp" }));
    const conv2 = await submit(a, form({ phone }));
    const rows = await t.db.select().from(contactConsents).where(and(eq(contactConsents.contactId, conv.contactId), eq(contactConsents.channel, "whatsapp"))).orderBy(contactConsents.createdAt);
    expect(rows.map((r) => r.status)).toEqual(["otorgado", "retirado"]);
    await expectCode(as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, conv2, { body: "Hola", via: "whatsapp" })), "whatsapp_blocked");
  });

  it("H-8: no se asigna una conversación a alguien de solo lectura", async () => {
    const a = await newAgency("Bandeja H8");
    const convId = await submit(a, form());
    await expectCode(as(t.db, a.admin, (tx) => assignConversation(tx, a.admin.id, a.id, convId, a.lectura.id)), "assignee_read_only");
  });
});

describe("datos sin verificar (D-14, decisión de Felipe del 2 nov 2026)", () => {
  it("un correo que llega por formulario a un contacto existente queda sin verificar y no se usa hasta confirmarlo", async () => {
    const a = await newAgency("Bandeja D14");
    const contactId = await as(t.db, a.ana, (tx) => createContact(tx, a.ana.id, a.id, { fullName: "Rosa", phones: [{ raw: "+57 300 444 5566" }], emails: [] }));
    const convId = await submit(a, form({ phone: "+573004445566", email: "otra.persona@example.com" }));
    const [email] = await t.db.select().from(contactEmails).where(eq(contactEmails.contactId, contactId));
    expect(email).toMatchObject({ email: "otra.persona@example.com", unverified: true, isPreferred: false });
    // El teléfono que ya tenía el contacto sigue verificado.
    const [phone] = await t.db.select().from(contactPhones).where(eq(contactPhones.contactId, contactId));
    expect(phone.unverified).toBe(false);
    await expectCode(as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, convId, { body: "Hola", via: "correo" })), "email_unverified");
    // Editar el contacto no lo confirma sin querer.
    await as(t.db, a.ana, (tx) => updateContact(tx, a.ana.id, a.id, contactId, { fullName: "Rosa María", phones: [{ raw: "+57 300 444 5566" }], emails: ["otra.persona@example.com"] }));
    const d = await as(t.db, a.ana, (tx) => getContactDetail(tx, a.ana.id, a.id, contactId));
    expect(d.emails[0].unverified).toBe(true);
    // Guardar la ficha vuelve a escribir los datos, con id nuevo.
    const emailId = d.emails[0].id;
    // Lectura no confirma; otra agencia no lo encuentra.
    const b = await newAgency("Bandeja D14 B");
    await expectCode(as(t.db, a.lectura, (tx) => verifyContactPoint(tx, a.lectura.id, a.id, { kind: "correo", id: emailId })), "permission_denied");
    await expectCode(as(t.db, b.admin, (tx) => verifyContactPoint(tx, b.admin.id, b.id, { kind: "correo", id: emailId })), "not_found");
    await as(t.db, a.ana, (tx) => verifyContactPoint(tx, a.ana.id, a.id, { kind: "correo", id: emailId }));
    const r = await as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, convId, { body: "Hola", via: "correo" }));
    expect(r.link.startsWith("mailto:otra.persona@example.com?")).toBe(true);
  });

  it("un contacto nuevo del formulario queda con sus datos verificados", async () => {
    const a = await newAgency("Bandeja D14 nuevo");
    const convId = await submit(a, form({ email: "nuevo@example.com" }));
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    const emails = await t.db.select().from(contactEmails).where(eq(contactEmails.contactId, conv.contactId));
    const phones = await t.db.select().from(contactPhones).where(eq(contactPhones.contactId, conv.contactId));
    expect([...emails, ...phones].every((x) => !x.unverified)).toBe(true);
  });

  it("prueba independiente de D-14: un teléfono sin verificar no se usa en tareas ni en WhatsApp, y guardar la ficha no lo vuelve preferido", async () => {
    const a = await newAgency("Bandeja D14 tel");
    const contactId = await as(t.db, a.ana, (tx) => createContact(tx, a.ana.id, a.id, { fullName: "Tomás", phones: [], emails: ["tomas@example.com"] }));
    const convId = await submit(a, form({ phone: "+573007778899", email: "tomas@example.com" }));
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv.contactId).toBe(contactId);
    const [phone] = await t.db.select().from(contactPhones).where(eq(contactPhones.contactId, contactId));
    expect(phone).toMatchObject({ unverified: true, isPreferred: false });

    const wa = (await t.db.select().from(tasks).where(eq(tasks.opportunityId, conv.opportunityId!))).find((x) => x.kind === "whatsapp")!;
    await expectCode(as(t.db, a.ana, (tx) => openTaskLink(tx, a.ana.id, a.id, wa.id)), "phone_unverified");
    await expectCode(as(t.db, a.ana, (tx) => openWhatsapp(tx, a.ana.id, a.id, contactId, { message: "Hola" })), "phone_unverified");
    const ch = await as(t.db, a.ana, (tx) => contactChannels(tx, a.ana.id, a.id, [contactId]));
    expect(ch.get(contactId)).toMatchObject({ phone: false, phoneUnverified: true, email: true });

    // Guardar la ficha con el teléfono primero no lo vuelve preferido ni lo muestra como dato normal.
    await as(t.db, a.ana, (tx) => updateContact(tx, a.ana.id, a.id, contactId, { fullName: "Tomás", phones: [{ raw: "+57 300 777 8899" }], emails: ["tomas@example.com"] }));
    const [after] = await t.db.select().from(contactPhones).where(eq(contactPhones.contactId, contactId));
    expect(after).toMatchObject({ unverified: true, isPreferred: false });
    const [row] = await as(t.db, a.ana, (tx) => listContacts(tx, a.ana.id, a.id, "Tomás"));
    expect(row.phone).toBeNull();
    expect(row.email).toBe("tomas@example.com");

    // Al confirmarlo pasa a ser el preferido, porque no hay otro teléfono.
    await as(t.db, a.ana, (tx) => verifyContactPoint(tx, a.ana.id, a.id, { kind: "telefono", id: after.id }));
    const [ok] = await t.db.select().from(contactPhones).where(eq(contactPhones.contactId, contactId));
    expect(ok).toMatchObject({ unverified: false, isPreferred: true });
    expect((await as(t.db, a.ana, (tx) => openTaskLink(tx, a.ana.id, a.id, wa.id))).channel).toBe("whatsapp");
  });
});

