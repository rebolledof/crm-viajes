// SPEC-002c · Marca por agencia, preferencias personales y guía paso a paso contra PostgreSQL real.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../../src/db/client";
import { agencyBranding, auditEvents, pipelineStages, tasks, userPreferences } from "../../src/db/schema";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, LOGO_MAX_BYTES } from "../../src/domain/branding";
import { acceptInvitation, createAgency, createInvitation } from "../../src/server/agencies";
import { getBranding, getLogo, getPreferences, setPreferences, updateBranding } from "../../src/server/branding";
import { createContact, listContacts } from "../../src/server/contacts";
import { AppError } from "../../src/server/errors";
import { createOpportunity, listStages, moveOpportunity, updateStage } from "../../src/server/opportunities";
import { completeTask, createTask, dueTodayCount, myDay } from "../../src/server/tasks";
import { as, createUser, testDb } from "./helpers";

const t = testDb();
afterAll(() => t.close());

type Agency = { id: string; admin: SessionUser; asesor: SessionUser };

async function newAgency(name: string): Promise<Agency> {
  const admin = await createUser(t.admin, "adm");
  const asesor = await createUser(t.admin, "ase");
  const id = await as(t.db, admin, (tx) => createAgency(tx, `${name} ${admin.id.slice(0, 6)}`));
  const inv = await as(t.db, admin, (tx) => createInvitation(tx, { userId: admin.id, agencyId: id, email: asesor.email, role: "asesor", now: new Date() }));
  await as(t.db, asesor, (tx) => acceptInvitation(tx, inv.token));
  return { id, admin, asesor };
}

async function expectCode(p: Promise<unknown>, code: string, field?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code && (field === undefined || e.field === field));
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const SVG = new Uint8Array(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));

/** Deja la oportunidad sin tareas abiertas (las plantillas de seguimiento crean algunas solas). */
async function clearOpenTasks(oppId: string) {
  await t.admin`update tasks set status = 'cancelada', result = 'prueba' where opportunity_id = ${oppId} and status = 'abierta'`;
}

async function newOpp(a: Agency, user: SessionUser, name: string) {
  const contactId = await as(t.db, user, (tx) => createContact(tx, user.id, a.id, { fullName: name, phones: [], emails: [] }));
  const oppId = await as(t.db, user, (tx) => createOpportunity(tx, user.id, a.id, { contactId, destination: "Cartagena", ownerId: user.id }));
  await clearOpenTasks(oppId);
  return { contactId, oppId };
}

function task(a: Agency, user: SessionUser, contactId: string, oppId: string | undefined, dueAt: Date, title = "Llamar") {
  return as(t.db, user, (tx) => createTask(tx, user.id, a.id, { contactId, opportunityId: oppId, title, kind: "llamada", dueAt, assigneeId: user.id, priority: "media" }));
}

describe("marca de la agencia (RF-240 a RF-242, RF-248)", () => {
  let A: Agency;
  let B: Agency;
  beforeAll(async () => {
    A = await newAgency("Marca A");
    B = await newAgency("Marca B");
  });

  it("sin configurar, la agencia usa los colores de fábrica y no tiene logo", async () => {
    const b = await as(t.db, A.asesor, (tx) => getBranding(tx, A.asesor.id, A.id));
    expect(b).toMatchObject({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT, hasLogo: false });
  });

  it("el administrador guarda colores y logo; todos en la agencia los ven", async () => {
    await as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "#c2185b", accent: "FFB300", logo: PNG }));
    const b = await as(t.db, A.asesor, (tx) => getBranding(tx, A.asesor.id, A.id));
    expect(b).toMatchObject({ primary: "#C2185B", accent: "#FFB300", hasLogo: true });
    const logo = await as(t.db, A.asesor, (tx) => getLogo(tx, A.asesor.id, A.id));
    expect(logo?.type).toBe("image/png");
    expect(new Uint8Array(logo!.bytes)).toEqual(PNG);
  });

  it("un asesor no puede cambiar la marca, ni por la aplicación ni directo en la base (AC-240)", async () => {
    await expectCode(as(t.db, A.asesor, (tx) => updateBranding(tx, A.asesor.id, A.id, { primary: "#000000", accent: "#000000" })), "permission_denied");
    const changed = await as(t.db, A.asesor, (tx) => tx.update(agencyBranding).set({ primaryColor: "#000000" }).where(eq(agencyBranding.agencyId, A.id)).returning());
    expect(changed).toHaveLength(0);
    const [row] = await t.admin`select primary_color from agency_branding where agency_id = ${A.id}`;
    expect(row.primary_color).toBe("#C2185B");
  });

  it("otra agencia no ve ni cambia la marca ajena (RLS)", async () => {
    // Para quien no es miembro, la agencia ajena "no existe".
    await expectCode(as(t.db, B.admin, (tx) => getBranding(tx, B.admin.id, A.id)), "not_found");
    const seen = await as(t.db, B.admin, (tx) => tx.select().from(agencyBranding).where(eq(agencyBranding.agencyId, A.id)));
    expect(seen).toHaveLength(0);
    await expect(
      as(t.db, B.admin, (tx) => tx.insert(agencyBranding).values({ agencyId: A.id, primaryColor: "#000000", accentColor: "#000000", updatedBy: B.admin.id })),
    ).rejects.toThrow();
    await expectCode(as(t.db, B.admin, (tx) => updateBranding(tx, B.admin.id, A.id, { primary: "#000000", accent: "#000000" })), "not_found");
  });

  it("cada agencia tiene su propia marca (AC-241)", async () => {
    await as(t.db, B.admin, (tx) => updateBranding(tx, B.admin.id, B.id, { primary: "#0F4C81", accent: "#F28C28" }));
    const [a, b] = await Promise.all([as(t.db, A.admin, (tx) => getBranding(tx, A.admin.id, A.id)), as(t.db, B.admin, (tx) => getBranding(tx, B.admin.id, B.id))]);
    expect(a.primary).toBe("#C2185B");
    expect(b.primary).toBe("#0F4C81");
    expect(b.hasLogo).toBe(false);
  });

  it("rechaza colores inválidos señalando el campo", async () => {
    await expectCode(as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "rojo", accent: "#FFB300" })), "invalid_color", "primary");
    await expectCode(as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "#C2185B", accent: "#FFB30;}" })), "invalid_color", "accent");
  });

  it("rechaza un logo de más de 512 KB o que no sea PNG, WebP o JPG (AC-242)", async () => {
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(PNG);
    await expectCode(as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "#C2185B", accent: "#FFB300", logo: big })), "logo_too_big", "logo");
    await expectCode(as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "#C2185B", accent: "#FFB300", logo: SVG })), "logo_type", "logo");
    await expectCode(as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "#C2185B", accent: "#FFB300", logo: new Uint8Array(Buffer.from("%PDF-1.7")) })), "logo_type", "logo");
    expect((await as(t.db, A.admin, (tx) => getLogo(tx, A.admin.id, A.id)))?.type).toBe("image/png");
  });

  it("la base también rechaza un logo demasiado grande aunque se salte la aplicación", async () => {
    const big = Buffer.alloc(LOGO_MAX_BYTES + 1);
    await expect(as(t.db, A.admin, (tx) => tx.update(agencyBranding).set({ logo: big, logoType: "image/png" }).where(eq(agencyBranding.agencyId, A.id)))).rejects.toThrow();
  });

  it("guardar sin archivo conserva el logo; «quitar» lo borra", async () => {
    await as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "#C2185B", accent: "#FFB300" }));
    expect((await as(t.db, A.admin, (tx) => getBranding(tx, A.admin.id, A.id))).hasLogo).toBe(true);
    await as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "#C2185B", accent: "#FFB300", logo: "quitar" }));
    expect((await as(t.db, A.admin, (tx) => getBranding(tx, A.admin.id, A.id))).hasLogo).toBe(false);
    expect(await as(t.db, A.admin, (tx) => getLogo(tx, A.admin.id, A.id))).toBeNull();
  });

  it("la auditoría guarda quién cambió la marca y el color anterior y el nuevo (AC-250)", async () => {
    await as(t.db, A.admin, (tx) => updateBranding(tx, A.admin.id, A.id, { primary: "#0F6E6E", accent: "#FFB300" }));
    const events = await as(t.db, A.admin, (tx) =>
      tx.select().from(auditEvents).where(and(eq(auditEvents.agencyId, A.id), eq(auditEvents.action, "branding.updated"))).orderBy(auditEvents.createdAt),
    );
    const last = events.at(-1)!;
    expect(last.actorId).toBe(A.admin.id);
    expect(last.changes).toEqual({ primaryColor: { de: "#C2185B", a: "#0F6E6E" } });
    expect(events[0].changes).toMatchObject({ primaryColor: { de: DEFAULT_PRIMARY, a: "#C2185B" }, logo: "cambiado" });
    expect(events.some((e) => (e.changes as Record<string, unknown>).logo === "quitado")).toBe(true);
  });
});

describe("preferencias personales (RF-243, RF-244)", () => {
  it("un usuario nuevo tiene menú arriba y tema claro; lo que elige se guarda en la base (AC-244)", async () => {
    const A = await newAgency("Pref");
    expect(await as(t.db, A.asesor, (tx) => getPreferences(tx, A.asesor.id))).toEqual({ navLayout: "top", navCollapsed: false, theme: "light" });
    await as(t.db, A.asesor, (tx) => setPreferences(tx, A.asesor.id, { navLayout: "side", theme: "dark" }));
    await as(t.db, A.asesor, (tx) => setPreferences(tx, A.asesor.id, { navCollapsed: true }));
    // Otra "sesión" (otro navegador) lee lo mismo porque vive en la base.
    expect(await as(t.db, A.asesor, (tx) => getPreferences(tx, A.asesor.id))).toEqual({ navLayout: "side", navCollapsed: true, theme: "dark" });
  });

  it("rechaza valores desconocidos", async () => {
    const u = await createUser(t.admin, "pref");
    await expectCode(as(t.db, u, (tx) => setPreferences(tx, u.id, { theme: "rosa" })), "invalid_input");
    await expectCode(as(t.db, u, (tx) => setPreferences(tx, u.id, { navCollapsed: "si" })), "invalid_input");
  });

  it("nadie ve ni cambia las preferencias de otra persona, aunque sea de su agencia (RLS)", async () => {
    const A = await newAgency("Pref2");
    await as(t.db, A.asesor, (tx) => setPreferences(tx, A.asesor.id, { theme: "dark" }));
    const seen = await as(t.db, A.admin, (tx) => tx.select().from(userPreferences).where(eq(userPreferences.userId, A.asesor.id)));
    expect(seen).toHaveLength(0);
    const changed = await as(t.db, A.admin, (tx) => tx.update(userPreferences).set({ theme: "light" }).where(eq(userPreferences.userId, A.asesor.id)).returning());
    expect(changed).toHaveLength(0);
    await expect(as(t.db, A.admin, (tx) => tx.insert(userPreferences).values({ userId: A.asesor.id, theme: "light" }))).rejects.toThrow();
    expect((await as(t.db, A.asesor, (tx) => getPreferences(tx, A.asesor.id))).theme).toBe("dark");
  });
});

describe("meta de cada etapa", () => {
  it("el administrador escribe la meta; vacía se borra; más de 120 letras se rechaza", async () => {
    const A = await newAgency("Meta");
    const [first] = await as(t.db, A.admin, (tx) => listStages(tx, A.admin.id, A.id));
    await as(t.db, A.admin, (tx) => updateStage(tx, A.admin.id, A.id, first.id, { goal: "  Contactar en menos de 24 h " }));
    expect((await as(t.db, A.asesor, (tx) => listStages(tx, A.asesor.id, A.id)))[0].goal).toBe("Contactar en menos de 24 h");
    await expectCode(as(t.db, A.admin, (tx) => updateStage(tx, A.admin.id, A.id, first.id, { goal: "x".repeat(121) })), "invalid_input", "goal");
    await as(t.db, A.admin, (tx) => updateStage(tx, A.admin.id, A.id, first.id, { name: first.name, goal: "" }));
    expect((await as(t.db, A.admin, (tx) => listStages(tx, A.admin.id, A.id)))[0].goal).toBeNull();
    // El formulario manda nombre y meta juntos: la auditoría solo guarda lo que cambió.
    const audit = await as(t.db, A.admin, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.objectId, first.id), eq(auditEvents.action, "stage.updated"))).orderBy(auditEvents.createdAt));
    expect(audit.map((e) => e.changes)).toEqual([{ goal: "Contactar en menos de 24 h" }, { goal: null }]);
  });

  it("un asesor no cambia la meta, ni por la aplicación ni directo en la base", async () => {
    const A = await newAgency("Meta2");
    const [first] = await as(t.db, A.admin, (tx) => listStages(tx, A.admin.id, A.id));
    await expectCode(as(t.db, A.asesor, (tx) => updateStage(tx, A.asesor.id, A.id, first.id, { goal: "x" })), "permission_denied");
    const changed = await as(t.db, A.asesor, (tx) => tx.update(pipelineStages).set({ goal: "x" }).where(eq(pipelineStages.id, first.id)).returning());
    expect(changed).toHaveLength(0);
  });
});

describe("guía paso a paso (RF-245 a RF-247)", () => {
  let A: Agency;
  const now = new Date();
  const hour = 3600_000;
  beforeAll(async () => {
    A = await newAgency("Guia");
  });

  it("al completar la última tarea de una oportunidad abierta se pide el siguiente paso (AC-249)", async () => {
    const { contactId, oppId } = await newOpp(A, A.asesor, "Ana Guía");
    const t1 = await task(A, A.asesor, contactId, oppId, new Date(now.getTime() + hour));
    const t2 = await task(A, A.asesor, contactId, oppId, new Date(now.getTime() + 2 * hour));
    expect(await as(t.db, A.asesor, (tx) => completeTask(tx, A.asesor.id, A.id, t1, "Confirmó fechas"))).toEqual({ opportunityId: oppId, needsNextStep: false });
    expect(await as(t.db, A.asesor, (tx) => completeTask(tx, A.asesor.id, A.id, t2, "Envió pasaportes"))).toEqual({ opportunityId: oppId, needsNextStep: true });
    // Si no la crea, la oportunidad aparece en "Sin siguiente paso" de Mi día.
    const day = await as(t.db, A.asesor, (tx) => myDay(tx, A.asesor.id, A.id, now));
    expect(day.withoutNextAction.map((o) => o.id)).toContain(oppId);
  });

  it("no pide siguiente paso si la tarea no tiene oportunidad o la oportunidad está cerrada", async () => {
    const contactId = await as(t.db, A.asesor, (tx) => createContact(tx, A.asesor.id, A.id, { fullName: "Sin Opp", phones: [], emails: [] }));
    const solo = await task(A, A.asesor, contactId, undefined, now);
    expect(await as(t.db, A.asesor, (tx) => completeTask(tx, A.asesor.id, A.id, solo, "Hecho"))).toEqual({ opportunityId: null, needsNextStep: false });

    const { contactId: c2, oppId } = await newOpp(A, A.asesor, "Cerrada");
    const last = await task(A, A.asesor, c2, oppId, now);
    const won = (await as(t.db, A.admin, (tx) => listStages(tx, A.admin.id, A.id))).find((s) => s.kind === "ganada")!;
    await as(t.db, A.asesor, (tx) => moveOpportunity(tx, A.asesor.id, A.id, oppId, { stageId: won.id, wonEvidence: "Pagó la reserva" }));
    // Mover a ganada cancela solo las tareas automáticas; la manual sigue abierta.
    const open = await t.db.select().from(tasks).where(and(eq(tasks.id, last), eq(tasks.status, "abierta")));
    expect(open).toHaveLength(1);
    expect(await as(t.db, A.asesor, (tx) => completeTask(tx, A.asesor.id, A.id, last, "Hecho"))).toEqual({ opportunityId: oppId, needsNextStep: false });
  });

  it("Mi día trae la etapa de cada tarea, cuenta lo hecho hoy y el contador del menú (AC-247)", async () => {
    const B = await newAgency("MiDia");
    const { contactId, oppId } = await newOpp(B, B.asesor, "Carla Día");
    await task(B, B.asesor, contactId, oppId, new Date(now.getTime() - 26 * hour), "Vencida 1");
    await task(B, B.asesor, contactId, oppId, new Date(now.getTime() - 25 * hour), "Vencida 2");
    const done = await task(B, B.asesor, contactId, oppId, new Date(now.getTime() - 24 * hour), "Ya hecha");
    await as(t.db, B.asesor, (tx) => completeTask(tx, B.asesor.id, B.id, done, "Listo"));
    const day = await as(t.db, B.asesor, (tx) => myDay(tx, B.asesor.id, B.id, now));
    expect(day.due.map((d) => d.task.title)).toEqual(["Vencida 1", "Vencida 2"]);
    const stage = (await as(t.db, B.admin, (tx) => listStages(tx, B.admin.id, B.id)))[0].name;
    expect(day.due.every((d) => d.stageName === stage)).toBe(true);
    expect(day.doneToday).toBe(1);
    expect(await as(t.db, B.asesor, (tx) => dueTodayCount(tx, B.asesor.id, B.id, now))).toBe(2);
    // El administrador no tiene tareas asignadas: su contador es 0.
    expect(await as(t.db, B.admin, (tx) => dueTodayCount(tx, B.admin.id, B.id, now))).toBe(0);
  });

  it("la lista de contactos trae el siguiente paso y la etapa del viaje en curso", async () => {
    const C = await newAgency("Lista");
    const { contactId, oppId } = await newOpp(C, C.asesor, "Diego Lista");
    const sinPaso = await newOpp(C, C.asesor, "Elena Sin Paso");
    await task(C, C.asesor, contactId, oppId, new Date(now.getTime() + 5 * hour), "Segunda");
    await task(C, C.asesor, contactId, oppId, new Date(now.getTime() + hour), "Primera");
    const rows = await as(t.db, C.asesor, (tx) => listContacts(tx, C.asesor.id, C.id));
    const diego = rows.find((r) => r.id === contactId)!;
    expect(diego.nextTask?.title).toBe("Primera");
    expect(new Date(diego.nextTask!.due_at).getTime()).toBeCloseTo(now.getTime() + hour, -4);
    expect(diego.stageName).toBeTruthy();
    const elena = rows.find((r) => r.id === sinPaso.contactId)!;
    expect(elena.nextTask).toBeNull();
    expect(elena.openOpportunities).toBe(1);
  });
});
