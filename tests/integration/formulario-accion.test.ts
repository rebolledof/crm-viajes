// SPEC-003 · Informe de pruebas del 3 nov 2026: el envío del formulario público pasando por la
// acción del servidor (como un POST real), no solo por la función de la base.
// - AC-274: el sexto envío seguido desde la misma dirección se rechaza y no crea datos.
// - AC-262: un agency_id o agencyId agregado al cuerpo del formulario se ignora.
// - AC-262: un código que no existe muestra "No encontramos este formulario" en el HTML del servidor,
//   sin depender de JavaScript (prueba independiente del 3 nov 2026).
import { and, eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";
import { contacts, conversations, inboundChannels } from "../../src/db/schema";
import { createAgency } from "../../src/server/agencies";
import { createUser, as, testDb } from "./helpers";

process.env.DATABASE_URL = inject("dbUrl");

const request: { ip: string | null; forwarded: string | null } = { ip: "203.0.113.7", forwarded: null };
vi.mock("next/headers", () => ({
  headers: async () => {
    const h = new Headers();
    if (request.ip) h.set("x-real-ip", request.ip);
    if (request.forwarded) h.set("x-forwarded-for", request.forwarded);
    return h;
  },
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

const { submitWebFormAction } = await import("../../src/app/f/[key]/actions");
const formPage = await import("../../src/app/f/[key]/page");

const t = testDb();
afterAll(() => t.close());

async function newAgency(name: string) {
  const admin = await createUser(t.admin, "adm");
  const id = await as(t.db, admin, (tx) => createAgency(tx, `${name} ${admin.id.slice(0, 6)}`));
  const [ch] = await t.db.select().from(inboundChannels).where(and(eq(inboundChannels.agencyId, id), eq(inboundChannels.kind, "formulario")));
  return { id, key: ch.publicKey };
}

let seq = 0;
function body(key: string, extra: Record<string, string> = {}) {
  seq++;
  const fd = new FormData();
  fd.set("key", key);
  fd.set("name", `Límite ${seq}`);
  fd.set("phone", `300 555 ${String(1000 + seq).slice(-4)}`);
  fd.set("email", `limite.${seq}@example.com`);
  fd.set("destination", "Cartagena");
  fd.set("privacy", "on");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

/** Envía como lo haría el navegador: un envío bueno termina en redirect a la página de gracias. */
async function post(fd: FormData): Promise<"enviado" | string> {
  try {
    const r = await submitWebFormAction({}, fd);
    return r.error ?? "sin error";
  } catch (e) {
    if (e instanceof Redirect) return e.url.includes("enviado=1") ? "enviado" : e.url;
    throw e;
  }
}

beforeEach(() => {
  request.ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  request.forwarded = null;
});

describe("formulario web por la acción del servidor (informe de pruebas, 3 nov 2026)", () => {
  it("AC-274: el sexto envío seguido de la misma persona se rechaza con el mensaje y no crea datos", async () => {
    const a = await newAgency("Acción límite");
    for (let i = 0; i < 5; i++) expect(await post(body(a.key))).toBe("enviado");
    expect(await post(body(a.key))).toMatch(/Recibimos muchos envíos seguidos/);
    expect(await t.db.select().from(conversations).where(eq(conversations.agencyId, a.id))).toHaveLength(5);
  });

  it("AC-274: la dirección sale de x-forwarded-for cuando no hay x-real-ip, y cuenta igual", async () => {
    const a = await newAgency("Acción límite xff");
    request.ip = null;
    request.forwarded = "198.51.100.9, 10.0.0.1";
    for (let i = 0; i < 5; i++) expect(await post(body(a.key))).toBe("enviado");
    expect(await post(body(a.key))).toMatch(/Recibimos muchos envíos seguidos/);
  });

  it("AC-262: agency_id o agencyId en el cuerpo del formulario no cambian la agencia", async () => {
    const a = await newAgency("Acción A");
    const b = await newAgency("Acción B");
    expect(await post(body(a.key, { agency_id: b.id, agencyId: b.id, agency: b.id }))).toBe("enviado");
    expect(await t.db.select().from(conversations).where(eq(conversations.agencyId, b.id))).toHaveLength(0);
    expect(await t.db.select().from(contacts).where(eq(contacts.agencyId, a.id))).toHaveLength(1);
  });

  it("AC-262: un código que no existe se explica en el HTML del servidor, con su título", async () => {
    const params = Promise.resolve({ key: "noexiste123" });
    const html = renderToStaticMarkup(await formPage.default({ params, searchParams: Promise.resolve({}) }));
    expect(html).toContain("No encontramos este formulario");
    expect(html).toContain("pedir el enlace correcto");
    expect((await formPage.generateMetadata({ params })).title).toBe("Formulario no encontrado");
  });

  it("un código válido sigue mostrando el formulario de su agencia", async () => {
    const a = await newAgency("Página válida");
    const params = Promise.resolve({ key: a.key });
    expect((await formPage.generateMetadata({ params })).title).toBe("Pide tu cotización");
  });
});
