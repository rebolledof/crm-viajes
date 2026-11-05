// SPEC-003 parte 2 · Chat web contra PostgreSQL real: primer mensaje, respuestas del asesor en la
// ventana del visitante, llave del visitante, pausa, límites, oportunidad y aislamiento.
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { withAnon, type SessionUser } from "../../src/db/client";
import { activities, chatVisitors, contactConsents, contactEmails, conversations, inboundChannels, opportunities, tasks } from "../../src/db/schema";
import type { ChatStartData } from "../../src/domain/chat";
import { acceptInvitation, createAgency, createInvitation } from "../../src/server/agencies";
import { createContact } from "../../src/server/contacts";
import { AppError, pgError } from "../../src/server/errors";
import {
  createConversationOpportunity,
  getConversation,
  getInboxSettings,
  linkConversationOpportunity,
  listConversations,
  replyConversation,
  resolveConversation,
  updateInboxSettings,
} from "../../src/server/inbox";
import { createOpportunity } from "../../src/server/opportunities";
import { chatInfo, chatMessages, sendChat, startChat } from "../../src/server/public-chat";
import { as, createUser, testDb } from "./helpers";

const t = testDb();
afterAll(() => t.close());

type Agency = { id: string; chatKey: string; formKey: string; admin: SessionUser; ana: SessionUser; luis: SessionUser; lectura: SessionUser };

async function newAgency(name: string, active = true): Promise<Agency> {
  const admin = await createUser(t.admin, "adm");
  const ana = await createUser(t.admin, "ana.perez");
  const luis = await createUser(t.admin, "luis");
  const lectura = await createUser(t.admin, "lec");
  const id = await as(t.db, admin, (tx) => createAgency(tx, `${name} ${admin.id.slice(0, 6)}`));
  for (const [who, role] of [[ana, "asesor"], [luis, "asesor"], [lectura, "lectura"]] as const) {
    const inv = await as(t.db, admin, (tx) => createInvitation(tx, { userId: admin.id, agencyId: id, email: who.email, role, now: new Date() }));
    await as(t.db, who, (tx) => acceptInvitation(tx, inv.token));
  }
  const chs = await t.db.select().from(inboundChannels).where(eq(inboundChannels.agencyId, id));
  const chat = chs.find((c) => c.kind === "chat")!;
  if (active) await as(t.db, admin, (tx) => updateInboxSettings(tx, admin.id, id, { maxMinutes: 30, privacyUrl: null, formActive: true, chatActive: true }));
  return { id, chatKey: chat.publicKey, formKey: chs.find((c) => c.kind === "formulario")!.publicKey, admin, ana, luis, lectura };
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
const chat = (over: Partial<ChatStartData> = {}): ChatStartData => ({
  name: "Camila Chat",
  phone: `+57301${String(1000000 + Math.floor(Math.random() * 8999999))}`,
  email: null,
  message: "Hola, ¿tienen planes a San Andrés en diciembre?",
  ...over,
});
const start = (a: Agency, data: ChatStartData = chat(), ip = `10.1.0.${++ipSeq}`) => withAnon(t.db, (tx) => startChat(tx, a.chatKey, data, ip));
const read = (a: Agency, token: string) => withAnon(t.db, (tx) => chatMessages(tx, a.chatKey, token));
const send = (a: Agency, token: string, body: string) => withAnon(t.db, (tx) => sendChat(tx, a.chatKey, token, body));

describe("canal de chat (D-17, RF-262)", () => {
  it("cada agencia nueva tiene su chat pausado hasta que el administrador lo enciende", async () => {
    const a = await newAgency("Chat canal", false);
    expect((await withAnon(t.db, (tx) => chatInfo(tx, a.chatKey)))?.active).toBe(false);
    await expectCode(start(a), "channel_closed");
    const s = await as(t.db, a.admin, (tx) => getInboxSettings(tx, a.admin.id, a.id));
    expect(s.chat?.active).toBe(false);
    await as(t.db, a.admin, (tx) => updateInboxSettings(tx, a.admin.id, a.id, { maxMinutes: 30, privacyUrl: null, formActive: true, chatActive: true }));
    expect((await withAnon(t.db, (tx) => chatInfo(tx, a.chatKey)))?.active).toBe(true);
    // Guardar sin decir nada del chat no lo apaga (pantallas que solo cambian el formulario).
    await as(t.db, a.admin, (tx) => updateInboxSettings(tx, a.admin.id, a.id, { maxMinutes: 45, privacyUrl: null, formActive: true }));
    expect((await withAnon(t.db, (tx) => chatInfo(tx, a.chatKey)))?.active).toBe(true);
  });

  it("el código del formulario no sirve como código de chat, ni al revés", async () => {
    const a = await newAgency("Chat códigos");
    expect(await withAnon(t.db, (tx) => chatInfo(tx, a.formKey))).toBeNull();
    await expectCode(withAnon(t.db, (tx) => startChat(tx, a.formKey, chat(), "1.2.3.4")), "channel_closed");
  });
});

describe("primer mensaje (RF-272, AC-277, AC-286)", () => {
  it("AC-277: crea contacto, conversación sin asignar con canal chat, consentimiento y ninguna oportunidad", async () => {
    const a = await newAgency("Chat inicio");
    const { token, conversationId } = await start(a, chat({ email: "camila@example.com" }));
    const c = await as(t.db, a.admin, (tx) => getConversation(tx, a.admin.id, a.id, conversationId));
    expect(c.conversation).toMatchObject({ channel: "chat", status: "abierta", assigneeId: null, opportunityId: null });
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]).toMatchObject({ direction: "entrante", via: "chat" });
    expect((await as(t.db, a.ana, (tx) => listConversations(tx, a.ana.id, a.id, { filter: "sin_asignar", now: new Date() }))).map((r) => r.id)).toEqual([conversationId]);
    expect(await t.db.select().from(opportunities).where(eq(opportunities.agencyId, a.id))).toHaveLength(0);
    const consents = await t.db.select().from(contactConsents).where(eq(contactConsents.contactId, c.conversation.contactId));
    expect(consents.map((x) => x.channel).sort()).toEqual(["correo", "telefono", "whatsapp"]);
    expect(consents.every((x) => x.source.startsWith("Chat web"))).toBe(true);
    // El visitante ve su mensaje con su llave.
    expect((await read(a, token)).map((m) => m.body)).toEqual([chat().message]);
  });

  it("AC-286 (D-16): un teléfono conocido con un correo nuevo vincula el contacto y deja el correo sin verificar", async () => {
    const a = await newAgency("Chat D-16");
    const contactId = await as(t.db, a.luis, (tx) => createContact(tx, a.luis.id, a.id, { fullName: "Pedro", phones: [{ raw: "300 555 0101" }], emails: [] }));
    const { conversationId } = await start(a, chat({ phone: "+573005550101", email: "otro@example.com" }));
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv.contactId).toBe(contactId);
    const [email] = await t.db.select().from(contactEmails).where(eq(contactEmails.contactId, contactId));
    expect(email).toMatchObject({ email: "otro@example.com", unverified: true, isPreferred: false });
  });

  it("AC-264 (chat): un contacto con oportunidad abierta de Luis queda con Luis, sin vincular la oportunidad", async () => {
    const a = await newAgency("Chat dueño");
    const contactId = await as(t.db, a.luis, (tx) => createContact(tx, a.luis.id, a.id, { fullName: "Rosa", phones: [{ raw: "300 555 0202" }], emails: [] }));
    await as(t.db, a.luis, (tx) => createOpportunity(tx, a.luis.id, a.id, { contactId, destination: "Cusco", ownerId: a.luis.id }));
    const { conversationId } = await start(a, chat({ phone: "+573005550202" }));
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv).toMatchObject({ assigneeId: a.luis.id, opportunityId: null });
  });

  it("rechaza datos inválidos aunque se salten el servidor", async () => {
    const a = await newAgency("Chat inválido");
    await expectCode(start(a, chat({ phone: null, email: null })), "invalid_input");
    await expectCode(start(a, chat({ message: "   " })), "invalid_input");
    await expectCode(start(a, chat({ message: "x".repeat(4001) })), "invalid_input");
  });
});

describe("conversación con el visitante (RF-273, RF-274, AC-278, AC-279, AC-272, AC-280)", () => {
  it("AC-278: la respuesta de Ana por chat deja la conversación pendiente y el visitante la ve con el nombre de Ana", async () => {
    const a = await newAgency("Chat respuesta");
    const { token, conversationId } = await start(a);
    const r = await as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, conversationId, { body: "Hola, claro que sí", via: "chat" }));
    expect(r.link).toBeNull();
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv).toMatchObject({ status: "pendiente", assigneeId: a.ana.id });
    const msgs = await read(a, token);
    expect(msgs.map((m) => [m.direction, m.body, m.authorName])).toEqual([
      ["entrante", chat().message, null],
      ["saliente", "Hola, claro que sí", "Ana"],
    ]);
    // El visitante no ve el correo de Ana en ninguna parte.
    expect(JSON.stringify(msgs)).not.toContain("@");
    const act = await t.db.select().from(activities).where(and(eq(activities.agencyId, a.id), eq(activities.kind, "bandeja.respuesta")));
    expect(act[0].data).toMatchObject({ via: "chat" });
  });

  it("solo una conversación de chat se responde por chat; lo enviado por WhatsApp no aparece en la ventana", async () => {
    const a = await newAgency("Chat vía");
    const { token, conversationId } = await start(a);
    await as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, conversationId, { body: "Te escribo al WhatsApp", via: "whatsapp" }));
    expect((await read(a, token)).map((m) => m.body)).toEqual([chat().message]);
    const formConv = await t.db.select().from(conversations).where(and(eq(conversations.agencyId, a.id), eq(conversations.channel, "chat")));
    expect(formConv).toHaveLength(1);
  });

  it("AC-279: el visitante vuelve, ve su historial y su mensaje reabre una conversación resuelta", async () => {
    const a = await newAgency("Chat volver");
    const { token, conversationId } = await start(a);
    await as(t.db, a.ana, (tx) => replyConversation(tx, a.ana.id, a.id, conversationId, { body: "¿Para cuántas personas?", via: "chat" }));
    await as(t.db, a.ana, (tx) => resolveConversation(tx, a.ana.id, a.id, conversationId));
    expect(await read(a, token)).toHaveLength(2);
    await send(a, token, "Somos 3 adultos");
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv.status).toBe("abierta");
    expect(conv.replyDueAt).not.toBeNull();
    expect((await read(a, token)).map((m) => m.body).at(-1)).toBe("Somos 3 adultos");
  });

  it("AC-272: con la llave de otro visitante, una inventada o el código de otra agencia no se ve nada", async () => {
    const a = await newAgency("Chat aislado A");
    const b = await newAgency("Chat aislado B");
    const one = await start(a);
    const two = await start(a);
    expect((await read(a, one.token)).length).toBe(1);
    expect(await read(a, "A".repeat(43))).toEqual([]);
    expect(await read(a, "no-es-una-llave")).toEqual([]);
    // La llave de A con el código de B: nada, y no puede escribir en la conversación de A.
    expect(await read(b, one.token)).toEqual([]);
    await expectCode(send(b, one.token, "hola"), "not_found");
    await expectCode(send(a, "A".repeat(43), "hola"), "not_found");
    // Cada visitante solo ve lo suyo.
    await send(a, two.token, "Soy el segundo");
    expect((await read(a, one.token)).map((m) => m.body)).not.toContain("Soy el segundo");
  });

  it("AC-280: una llave sin mensajes hace más de 30 días ya no muestra el historial", async () => {
    const a = await newAgency("Chat vencido");
    const { token, conversationId } = await start(a);
    await t.admin`update public.conversations set last_inbound_at = now() - interval '31 days' where id = ${conversationId}`;
    expect(await read(a, token)).toEqual([]);
    await expectCode(send(a, token, "¿Siguen ahí?"), "not_found");
  });
});

describe("pausa y límites (RF-276, AC-282, AC-285)", () => {
  it("AC-282: con el chat pausado, un mensaje desde una ventana abierta se rechaza y no se guarda", async () => {
    const a = await newAgency("Chat pausa");
    const { token, conversationId } = await start(a);
    await as(t.db, a.admin, (tx) => updateInboxSettings(tx, a.admin.id, a.id, { maxMinutes: 30, privacyUrl: null, formActive: true, chatActive: false }));
    await expectCode(send(a, token, "¿Hola?"), "channel_closed");
    await expectCode(start(a), "channel_closed");
    const c = await as(t.db, a.admin, (tx) => getConversation(tx, a.admin.id, a.id, conversationId));
    expect(c.messages).toHaveLength(1);
  });

  it("AC-285: el sexto chat nuevo desde la misma dirección en 10 minutos se rechaza", async () => {
    const a = await newAgency("Chat límite");
    for (let i = 0; i < 5; i++) await start(a, chat(), "9.8.7.6");
    await expectCode(start(a, chat(), "9.8.7.6"), "rate_limited");
    expect(await t.db.select().from(conversations).where(eq(conversations.agencyId, a.id))).toHaveLength(5);
    await start(a, chat(), "9.8.7.7");
  });

  it("AC-285: más de 30 mensajes en 10 minutos en una conversación se rechazan; más de 4.000 letras también", async () => {
    const a = await newAgency("Chat ráfaga");
    const { token, conversationId } = await start(a);
    for (let i = 0; i < 29; i++) await send(a, token, `Mensaje ${i}`);
    await expectCode(send(a, token, "Uno más"), "rate_limited");
    await expectCode(send(a, token, "x".repeat(4001)), "invalid_input");
    const c = await as(t.db, a.admin, (tx) => getConversation(tx, a.admin.id, a.id, conversationId));
    expect(c.messages).toHaveLength(30);
  });
});

describe("oportunidad de la conversación (RF-275, AC-283)", () => {
  it("AC-283: Ana crea la oportunidad: primera etapa, origen Chat web, responsable Ana, tareas y vínculo", async () => {
    const a = await newAgency("Chat crear opp");
    const { conversationId } = await start(a);
    const oppId = await as(t.db, a.ana, (tx) => createConversationOpportunity(tx, a.ana.id, a.id, conversationId));
    const [opp] = await t.db.select().from(opportunities).where(eq(opportunities.id, oppId));
    expect(opp).toMatchObject({ source: "Chat web", ownerId: a.ana.id });
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv).toMatchObject({ opportunityId: oppId, assigneeId: a.ana.id });
    const ts = await t.db.select().from(tasks).where(eq(tasks.opportunityId, oppId));
    expect(ts.length).toBeGreaterThan(0);
    expect(ts.every((x) => x.assigneeId === a.ana.id)).toBe(true);
    await expectCode(as(t.db, a.ana, (tx) => createConversationOpportunity(tx, a.ana.id, a.id, conversationId)), "conversation_has_opportunity");
  });

  it("AC-283: vincular a una oportunidad abierta del mismo contacto; no a la de otro contacto ni de otra agencia", async () => {
    const a = await newAgency("Chat vincular");
    const b = await newAgency("Chat vincular B");
    const contactId = await as(t.db, a.luis, (tx) => createContact(tx, a.luis.id, a.id, { fullName: "Rosa", phones: [{ raw: "300 555 0303" }], emails: [] }));
    const mine = await as(t.db, a.luis, (tx) => createOpportunity(tx, a.luis.id, a.id, { contactId, destination: "Cusco", ownerId: a.luis.id }));
    const otherContact = await as(t.db, a.luis, (tx) => createContact(tx, a.luis.id, a.id, { fullName: "Otro", phones: [{ raw: "300 555 0404" }], emails: [] }));
    const notMine = await as(t.db, a.luis, (tx) => createOpportunity(tx, a.luis.id, a.id, { contactId: otherContact, ownerId: a.luis.id }));
    const bContact = await as(t.db, b.luis, (tx) => createContact(tx, b.luis.id, b.id, { fullName: "B", phones: [{ raw: "300 555 0505" }], emails: [] }));
    const bOpp = await as(t.db, b.luis, (tx) => createOpportunity(tx, b.luis.id, b.id, { contactId: bContact, ownerId: b.luis.id }));
    const { conversationId } = await start(a, chat({ phone: "+573005550303" }));
    const c = await as(t.db, a.luis, (tx) => getConversation(tx, a.luis.id, a.id, conversationId));
    expect(c.linkableOpportunities.map((o) => o.id)).toEqual([mine]);
    await expectCode(as(t.db, a.luis, (tx) => linkConversationOpportunity(tx, a.luis.id, a.id, conversationId, notMine)), "not_found");
    await expectCode(as(t.db, a.luis, (tx) => linkConversationOpportunity(tx, a.luis.id, a.id, conversationId, bOpp)), "not_found");
    await as(t.db, a.luis, (tx) => linkConversationOpportunity(tx, a.luis.id, a.id, conversationId, mine));
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv.opportunityId).toBe(mine);
  });

  it("Lectura no crea ni vincula; tampoco la base se lo deja", async () => {
    const a = await newAgency("Chat lectura");
    const { conversationId } = await start(a);
    await expectCode(as(t.db, a.lectura, (tx) => createConversationOpportunity(tx, a.lectura.id, a.id, conversationId)), "permission_denied");
    const contactId = (await t.db.select().from(conversations).where(eq(conversations.id, conversationId)))[0].contactId;
    const opp = await as(t.db, a.admin, (tx) => createOpportunity(tx, a.admin.id, a.id, { contactId, ownerId: a.admin.id }));
    await expectCode(as(t.db, a.lectura, (tx) => linkConversationOpportunity(tx, a.lectura.id, a.id, conversationId, opp)), "permission_denied");
    await as(t.db, a.lectura, (tx) => tx.update(conversations).set({ opportunityId: opp }).where(eq(conversations.id, conversationId)));
    const [conv] = await t.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv.opportunityId).toBeNull();
  });
});

describe("acceso (RLS y rol anon)", () => {
  it("nadie de la aplicación lee los visitantes del chat; anon solo llama a las funciones públicas", async () => {
    const a = await newAgency("Chat acceso");
    await start(a);
    await expectDb(as(t.db, a.admin, (tx) => tx.select().from(chatVisitors)), "42501");
    await expectDb(withAnon(t.db, (tx) => tx.select().from(chatVisitors)), "42501");
    await expectDb(withAnon(t.db, (tx) => tx.execute(sql`select app.chat_visitor(c, 'x') from public.inbound_channels c limit 1`)), "42501");
    const fns = await t.admin<{ proname: string }[]>`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute') order by 1`;
    expect(fns.map((f) => f.proname)).toEqual(["chat_info", "chat_messages", "chat_send", "chat_start", "submit_web_form", "web_form_info", "web_form_logo"]);
  });
});

describe("AC-281: horario de la agencia en la ventana del chat (prueba independiente, hallazgo 8)", () => {
  const info = (a: Agency) => withAnon(t.db, (tx) => chatInfo(tx, a.chatKey));
  const setHours = (a: Agency, tz: string, wd: [string, string], sat: [string | null, string | null]) =>
    t.admin`update public.agency_settings set time_zone = ${tz}, weekday_start = ${wd[0]}, weekday_end = ${wd[1]},
            saturday_start = ${sat[0]}, saturday_end = ${sat[1]} where agency_id = ${a.id}`;
  const localNow = (tz: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  };

  it("la hora local sale de la zona de la agencia", async () => {
    const a = await newAgency("Horario zona");
    for (const tz of ["America/Bogota", "Europe/Madrid"]) {
      await setHours(a, tz, ["08:00", "18:00"], ["08:00", "12:00"]);
      const i = (await info(a))!;
      expect(Math.abs(i.localNow.getTime() - localNow(tz).getTime())).toBeLessThan(2 * 60_000);
    }
  });

  it("abierto todo el día entre semana y sábado: abierto salvo el domingo, que abre el lunes a las 12 a. m.", async () => {
    const a = await newAgency("Horario abierto");
    await setHours(a, "America/Bogota", ["00:00", "23:59:59"], ["00:00", "23:59:59"]);
    const i = (await info(a))!;
    if (i.localNow.getUTCDay() === 0) {
      expect(i.openNow).toBe(false);
      expect(i.nextOpen.toISOString().slice(11, 16)).toBe("00:00");
    } else {
      expect(i.openNow).toBe(true);
      expect(i.nextOpen.getTime()).toBe(i.localNow.getTime());
    }
  });

  it("con una ventana de un segundo a medianoche y sin sábado está cerrado y dice cuándo vuelve", async () => {
    const a = await newAgency("Horario cerrado");
    await setHours(a, "America/Bogota", ["00:00", "00:00:01"], [null, null]);
    const i = (await info(a))!;
    expect(i.openNow).toBe(false);
    expect(i.nextOpen.getTime()).toBeGreaterThan(i.localNow.getTime());
    expect(i.nextOpen.toISOString().slice(11, 16)).toBe("00:00");
    expect([1, 2, 3, 4, 5]).toContain(i.nextOpen.getUTCDay());
  });
});
