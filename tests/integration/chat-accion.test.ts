// SPEC-003 parte 2 · El chat web pasando por las acciones del servidor, como lo usa el navegador
// (prueba independiente del 3 nov 2026, hallazgo 6): primer mensaje, campo trampa, datos que se
// conservan, límite, mensajes siguientes, llave vencida y la página de prueba del administrador.
import { and, eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";
import type { SessionUser } from "../../src/db/client";
import { contacts, conversations, inboundChannels } from "../../src/db/schema";
import { acceptInvitation, createAgency, createInvitation } from "../../src/server/agencies";
import { updateInboxSettings } from "../../src/server/inbox";
import { as, createUser, testDb } from "./helpers";

process.env.DATABASE_URL = inject("dbUrl");

const request: { ip: string } = { ip: "203.0.113.7" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": request.ip, host: "crm.test", "x-forwarded-proto": "https" }),
}));
class Redirect extends Error {
  constructor(public url: string) {
    super(url);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  notFound: () => {
    throw new Error("not_found");
  },
}));
// La sesión de la página de prueba: quién es y con qué papel, sin pasar por Supabase Auth.
const session: { ctx: unknown } = { ctx: null };
vi.mock("@/server/session", () => ({
  requireActiveAgency: async () => {
    if (!session.ctx) throw new Redirect("/login");
    return session.ctx;
  },
}));

const { startChatAction, sendChatAction, loadChatAction } = await import("../../src/app/c/[key]/actions");
const pruebaChat = await import("../../src/app/app/configuracion/canales/prueba-chat/page");

const t = testDb();
afterAll(() => t.close());

type Agency = { id: string; name: string; key: string; admin: SessionUser; asesor: SessionUser };

async function newAgency(label: string, active = true): Promise<Agency> {
  const admin = await createUser(t.admin, "adm");
  const asesor = await createUser(t.admin, "ase");
  const name = `${label} ${admin.id.slice(0, 6)}`;
  const id = await as(t.db, admin, (tx) => createAgency(tx, name));
  const inv = await as(t.db, admin, (tx) => createInvitation(tx, { userId: admin.id, agencyId: id, email: asesor.email, role: "asesor", now: new Date() }));
  await as(t.db, asesor, (tx) => acceptInvitation(tx, inv.token));
  if (active) await as(t.db, admin, (tx) => updateInboxSettings(tx, admin.id, id, { maxMinutes: 30, privacyUrl: null, formActive: true, chatActive: true }));
  const [ch] = await t.db.select().from(inboundChannels).where(and(eq(inboundChannels.agencyId, id), eq(inboundChannels.kind, "chat")));
  return { id, name, key: ch.publicKey, admin, asesor };
}

let seq = 0;
function form(key: string, extra: Record<string, string> = {}) {
  seq++;
  const fd = new FormData();
  fd.set("key", key);
  fd.set("name", `Visitante ${seq}`);
  fd.set("phone", `301 555 ${String(1000 + seq).slice(-4)}`);
  fd.set("email", "");
  fd.set("message", "Hola, ¿tienen planes a Cartagena?");
  fd.set("privacy", "on");
  fd.set("hp_contacto", "");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  request.ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  session.ctx = null;
});

describe("chat web por las acciones del servidor", () => {
  it("AC-277: el primer mensaje devuelve la llave del visitante y con ella se leen sus mensajes", async () => {
    const a = await newAgency("Acción chat");
    const r = await startChatAction({}, form(a.key));
    expect(r.error).toBeUndefined();
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const list = await loadChatAction(a.key, r.token!);
    expect(list.map((m) => [m.direction, m.body])).toEqual([["entrante", "Hola, ¿tienen planes a Cartagena?"]]);
  });

  it("AC-285: el campo trampa lleno responde 'recibido' sin llave y no crea nada", async () => {
    const a = await newAgency("Acción trampa");
    const r = await startChatAction({}, form(a.key, { hp_contacto: "https://spam.test" }));
    expect(r).toMatchObject({ received: true });
    expect(r.token).toBeUndefined();
    expect(await t.db.select().from(conversations).where(eq(conversations.agencyId, a.id))).toHaveLength(0);
    expect(await t.db.select().from(contacts).where(eq(contacts.agencyId, a.id))).toHaveLength(0);
  });

  it("un dato inválido señala el campo y conserva todo lo escrito", async () => {
    const a = await newAgency("Acción datos");
    const r = await startChatAction({}, form(a.key, { phone: "", message: "Quiero ir a Santa Marta" }));
    expect(r.field).toBe("phone");
    expect(r.values?.message).toEqual(["Quiero ir a Santa Marta"]);
    expect(r.values?.name?.[0]).toMatch(/^Visitante/);
    expect(r.token).toBeUndefined();
  });

  it("AC-285: el sexto chat nuevo desde la misma dirección se rechaza con el mensaje y conserva lo escrito", async () => {
    const a = await newAgency("Acción límite chat");
    for (let i = 0; i < 5; i++) expect((await startChatAction({}, form(a.key))).token).toBeTruthy();
    const r = await startChatAction({}, form(a.key, { message: "El sexto" }));
    expect(r.error).toMatch(/Recibimos muchos mensajes seguidos/);
    expect(r.values?.message).toEqual(["El sexto"]);
    expect(await t.db.select().from(conversations).where(eq(conversations.agencyId, a.id))).toHaveLength(5);
  });

  it("AC-262: un agency_id en el cuerpo no cambia la agencia", async () => {
    const a = await newAgency("Acción chat A");
    const b = await newAgency("Acción chat B");
    expect((await startChatAction({}, form(a.key, { agency_id: b.id, agencyId: b.id }))).token).toBeTruthy();
    expect(await t.db.select().from(conversations).where(eq(conversations.agencyId, b.id))).toHaveLength(0);
  });

  it("AC-282: con el chat pausado, el primer mensaje y los siguientes se rechazan diciendo qué hacer", async () => {
    const a = await newAgency("Acción pausa");
    const { token } = await startChatAction({}, form(a.key));
    await as(t.db, a.admin, (tx) => updateInboxSettings(tx, a.admin.id, a.id, { maxMinutes: 30, privacyUrl: null, formActive: true, chatActive: false }));
    expect((await startChatAction({}, form(a.key))).error).toMatch(/no está recibiendo mensajes/);
    expect(await sendChatAction(a.key, token!, "¿Siguen ahí?")).toEqual({ ok: false, error: expect.stringMatching(/no está recibiendo mensajes/) });
  });

  it("mensajes siguientes: se guardan; uno muy largo o vacío se rechaza sin marcar la llave como vencida", async () => {
    const a = await newAgency("Acción envío");
    const { token } = await startChatAction({}, form(a.key));
    expect(await sendChatAction(a.key, token!, "Somos dos adultos")).toEqual({ ok: true });
    const largo = await sendChatAction(a.key, token!, "x".repeat(4001));
    expect(largo).toMatchObject({ ok: false, error: expect.stringContaining("4.000") });
    expect("expired" in largo && largo.expired).toBeFalsy();
    expect(await sendChatAction(a.key, token!, "   ")).toMatchObject({ ok: false });
    expect((await loadChatAction(a.key, token!)).map((m) => m.body)).toEqual(["Hola, ¿tienen planes a Cartagena?", "Somos dos adultos"]);
  });

  it("AC-280 y AC-272: una llave inventada o de otra agencia se marca como vencida y no ve nada", async () => {
    const a = await newAgency("Acción llave A");
    const b = await newAgency("Acción llave B");
    const { token } = await startChatAction({}, form(a.key));
    const otra = await sendChatAction(b.key, token!, "Hola");
    expect(otra).toMatchObject({ ok: false, expired: true, error: expect.stringMatching(/ya no está disponible/) });
    expect(await sendChatAction(a.key, "A".repeat(43), "Hola")).toMatchObject({ ok: false, expired: true });
    expect(await loadChatAction(b.key, token!)).toEqual([]);
    expect(await loadChatAction(a.key, "no-es-una-llave")).toEqual([]);
  });
});

describe("AC-287: página de prueba del chat (D-17)", () => {
  const ctx = (who: SessionUser, a: Agency, role: "admin" | "asesor") => ({ user: who, active: { agencyId: a.id, agencyName: a.name, role } });

  it("el administrador ve la web de ejemplo con la burbuja de su agencia", async () => {
    const a = await newAgency("Prueba página");
    session.ctx = ctx(a.admin, a, "admin");
    const html = renderToStaticMarkup(await pruebaChat.default());
    expect(html).toContain("Probar el chat");
    expect(html).toContain(`https://crm.test/c/${a.key}/burbuja.js`);
    expect(html).not.toContain("El chat está apagado");
  });

  it("si el chat está apagado lo avisa y dice dónde encenderlo", async () => {
    const a = await newAgency("Prueba apagado", false);
    session.ctx = ctx(a.admin, a, "admin");
    expect(renderToStaticMarkup(await pruebaChat.default())).toContain("El chat está apagado");
  });

  it("un asesor no puede abrirla y una persona sin sesión va a ingresar", async () => {
    const a = await newAgency("Prueba asesor");
    session.ctx = ctx(a.asesor, a, "asesor");
    await expect(pruebaChat.default()).rejects.toMatchObject({ url: "/app?error=permission_denied" });
    session.ctx = null;
    await expect(pruebaChat.default()).rejects.toMatchObject({ url: "/login" });
  });
});
