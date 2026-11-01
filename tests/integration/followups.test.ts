// SPEC-002b · Plantillas de seguimiento contra PostgreSQL real: motor, horario hábil y permisos.
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../../src/db/client";
import { activities, agencySettings, followupSteps, followupTemplates, tasks } from "../../src/db/schema";
import { acceptInvitation, createAgency, createInvitation } from "../../src/server/agencies";
import { createContact } from "../../src/server/contacts";
import { AppError, pgError } from "../../src/server/errors";
import { addStep, createTemplate, listTemplates, updateSettings, updateTemplate } from "../../src/server/followups";
import { createOpportunity, listStages, moveOpportunity, updateOpportunity } from "../../src/server/opportunities";
import { cancelTask, completeTask, createTask, openTaskLink, updateTask } from "../../src/server/tasks";
import { recordConsent } from "../../src/server/contacts";
import { revokeMembership } from "../../src/server/agencies";
import { as, createUser, testDb } from "./helpers";

const t = testDb();
afterAll(() => t.close());

type Agency = { id: string; admin: SessionUser; asesor: SessionUser; asesor2: SessionUser };

async function newAgency(name: string): Promise<Agency> {
  const admin = await createUser(t.admin, "adm");
  const asesor = await createUser(t.admin, "ase");
  const asesor2 = await createUser(t.admin, "ase2");
  const id = await as(t.db, admin, (tx) => createAgency(tx, `${name} ${admin.id.slice(0, 6)}`));
  for (const who of [asesor, asesor2]) {
    const inv = await as(t.db, admin, (tx) => createInvitation(tx, { userId: admin.id, agencyId: id, email: who.email, role: "asesor", now: new Date() }));
    await as(t.db, who, (tx) => acceptInvitation(tx, inv.token));
  }
  return { id, admin, asesor, asesor2 };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

/** Error de la base (trigger o RLS), por su mensaje o código. */
async function expectDb(p: Promise<unknown>, text: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => {
    const pg = pgError(e);
    return pg?.message === text || pg?.code === text || (pg?.message ?? "").includes(text);
  });
}

async function stage(a: Agency, name: string) {
  const s = (await as(t.db, a.admin, (tx) => listStages(tx, a.admin.id, a.id))).find((x) => x.name === name);
  if (!s) throw new Error(`sin etapa ${name}`);
  return s.id;
}

async function newOpp(a: Agency, user: SessionUser, name: string, opts: { stageId?: string; ownerId?: string } = {}) {
  const contactId = await as(t.db, user, (tx) => createContact(tx, user.id, a.id, { fullName: name, phones: [], emails: [] }));
  const oppId = await as(t.db, user, (tx) => createOpportunity(tx, user.id, a.id, { contactId, destination: "Cancún", ...opts }));
  return { contactId, oppId };
}

function oppTasks(oppId: string) {
  return t.db.select().from(tasks).where(eq(tasks.opportunityId, oppId)).orderBy(tasks.dueAt);
}

async function template(a: Agency, name: string) {
  const [row] = await t.db.select().from(followupTemplates).where(and(eq(followupTemplates.agencyId, a.id), eq(followupTemplates.name, name)));
  return row;
}

describe("plantillas precargadas (AC-232)", () => {
  it("cada agencia nueva recibe las seis plantillas activas y no ve las de otra", async () => {
    const a = await newAgency("Seguimientos A");
    const b = await newAgency("Seguimientos B");
    const listA = await as(t.db, a.asesor, (tx) => listTemplates(tx, a.asesor.id, a.id));
    expect(listA.map((x) => x.name)).toEqual([
      "Oportunidad nueva: contacto rápido",
      "Calificado: preparar propuesta",
      "Propuesta enviada: seguimiento",
      "Negociación: cierre",
      "Ganado: bienvenida y documentos",
      "Perdido: reactivar más adelante",
    ]);
    expect(listA.every((x) => x.active && x.ownerId === null)).toBe(true);
    expect(listA[0].steps).toHaveLength(4);
    const seenByB = await as(t.db, b.admin, (tx) => tx.select().from(followupTemplates).where(eq(followupTemplates.agencyId, a.id)));
    expect(seenByB).toEqual([]);
  });
});

describe("horario hábil (AC-222, AC-223)", () => {
  async function due(from: string, amount: number, unit: string, at: string | null, agencyId: string) {
    const [r] = await t.admin<{ d: Date }[]>`select app.followup_due(${from}::timestamptz, ${amount}, ${unit}::public.delay_unit, ${at}::time, ${agencyId}) as d`;
    return r.d.toISOString();
  }

  it("calcula las fechas dentro de lunes a viernes 8-18 y sábado 8-12, hora de Colombia", async () => {
    const a = await newAgency("Horario");
    // Viernes 6 nov 2026 22:00 en Colombia.
    expect(await due("2026-11-06T22:00:00-05:00", 1, "horas_habiles", null, a.id)).toBe("2026-11-07T14:00:00.000Z"); // sáb 9:00
    expect(await due("2026-11-06T22:00:00-05:00", 15, "minutos", null, a.id)).toBe("2026-11-07T13:00:00.000Z"); // sáb 8:00
    // Sábado 11:30 + 1 hora hábil = lunes 8:30.
    expect(await due("2026-11-07T11:30:00-05:00", 1, "horas_habiles", null, a.id)).toBe("2026-11-09T13:30:00.000Z");
    // Martes 15:00 + 1 día hábil a las 10:00 = miércoles 10:00.
    expect(await due("2026-11-10T15:00:00-05:00", 1, "dias_habiles", "10:00", a.id)).toBe("2026-11-11T15:00:00.000Z");
    // Mismo día hábil a las 9:00 disparado a las 15:00: no queda en el pasado.
    expect(await due("2026-11-10T15:00:00-05:00", 0, "dias_habiles", "09:00", a.id)).toBe("2026-11-10T20:00:00.000Z");
    // Domingo + 0 minutos = lunes 8:00.
    expect(await due("2026-11-08T10:00:00-05:00", 0, "minutos", null, a.id)).toBe("2026-11-09T13:00:00.000Z");
    // Sábado + 1 día hábil, sin hora fija, conserva la hora: lunes 9:00.
    expect(await due("2026-11-07T09:00:00-05:00", 1, "dias_habiles", null, a.id)).toBe("2026-11-09T14:00:00.000Z");
    // Días calendario: 90 días después a las 10:00.
    expect(await due("2026-11-10T15:00:00-05:00", 90, "dias", "10:00", a.id)).toBe("2027-02-08T15:00:00.000Z");
  });

  it("respeta el horario que guarda el administrador (sin sábado)", async () => {
    const a = await newAgency("Horario propio");
    await as(t.db, a.admin, (tx) => updateSettings(tx, a.admin.id, a.id, { weekdayStart: "09:00", weekdayEnd: "17:00", saturdayStart: null, saturdayEnd: null, allowPersonalTemplates: false }));
    expect(await due("2026-11-06T22:00:00-05:00", 1, "horas_habiles", null, a.id)).toBe("2026-11-09T15:00:00.000Z"); // lun 10:00
    await expectCode(as(t.db, a.asesor, (tx) => updateSettings(tx, a.asesor.id, a.id, { weekdayStart: "08:00", weekdayEnd: "18:00", allowPersonalTemplates: true })), "permission_denied");
    await expectCode(as(t.db, a.admin, (tx) => updateSettings(tx, a.admin.id, a.id, { weekdayStart: "18:00", weekdayEnd: "08:00", allowPersonalTemplates: false })), "invalid_input");
  });
});

describe("motor de seguimiento", () => {
  it("una oportunidad nueva recibe 4 tareas del responsable; la primera es un WhatsApp con mensaje (AC-221)", async () => {
    const a = await newAgency("Motor");
    const { oppId, contactId } = await newOpp(a, a.asesor, "Paula Ríos");
    const list = await oppTasks(oppId);
    expect(list).toHaveLength(4);
    expect(list.every((x) => x.assigneeId === a.asesor.id && x.status === "abierta" && x.editLevel === "ajustable" && x.templateId)).toBe(true);
    expect(list[0]).toMatchObject({ kind: "whatsapp", priority: "alta" });
    expect(list[0].message).toContain("{nombre}");
    expect(list.map((x) => x.kind)).toEqual(["whatsapp", "llamada", "whatsapp", "correo"]);
    const hist = await t.db.select().from(activities).where(and(eq(activities.contactId, contactId), eq(activities.kind, "seguimiento.creado")));
    expect(hist[0].data).toMatchObject({ plantilla: "Oportunidad nueva: contacto rápido", cantidad: 4 });
  });

  it("al pasar a Contactado se cancelan las automáticas y la manual sigue abierta (AC-224)", async () => {
    const a = await newAgency("Cancelar");
    const { oppId, contactId } = await newOpp(a, a.asesor, "Mario Paz");
    const manual = await as(t.db, a.asesor, (tx) => createTask(tx, a.asesor.id, a.id, { contactId, opportunityId: oppId, kind: "tarea", title: "Manual", dueAt: new Date(Date.now() + 3600_000) }));
    // Pendiente de contacto está antes de la parada: no cancela.
    await as(t.db, a.asesor, async (tx) => moveOpportunity(tx, a.asesor.id, a.id, oppId, { stageId: await stage(a, "Pendiente de contacto") }));
    expect((await oppTasks(oppId)).filter((x) => x.status === "abierta")).toHaveLength(5);
    await as(t.db, a.asesor, async (tx) => moveOpportunity(tx, a.asesor.id, a.id, oppId, { stageId: await stage(a, "Contactado") }));
    const list = await oppTasks(oppId);
    const auto = list.filter((x) => x.templateId);
    expect(auto.every((x) => x.status === "cancelada" && x.result === "Cancelada automáticamente: la oportunidad pasó a Contactado")).toBe(true);
    expect(list.find((x) => x.id === manual)?.status).toBe("abierta");
    const hist = await t.db.select().from(activities).where(and(eq(activities.contactId, contactId), eq(activities.kind, "seguimiento.cancelado")));
    expect(hist[0].data).toMatchObject({ cantidad: 4, etapa: "Contactado" });
  });

  it("crear directo en una etapa posterior a la parada no inicia el contacto rápido", async () => {
    const a = await newAgency("Parada");
    const { oppId } = await newOpp(a, a.asesor, "Eva Luna", { stageId: await stage(a, "Contactado") });
    expect(await oppTasks(oppId)).toHaveLength(0);
  });

  it("al ganar se cancelan los seguimientos y se crean los de Ganado (AC-225)", async () => {
    const a = await newAgency("Ganar");
    const { oppId } = await newOpp(a, a.asesor, "Luis Mora", { stageId: await stage(a, "Propuesta enviada") });
    expect((await oppTasks(oppId)).map((x) => x.title)).toEqual([
      "Confirmar que revisó la propuesta",
      "Resolver dudas y ofrecer alternativas",
      "Aviso de vigencia de tarifas y cupos",
    ]);
    await as(t.db, a.asesor, async (tx) => moveOpportunity(tx, a.asesor.id, a.id, oppId, { stageId: await stage(a, "Ganado"), wonEvidence: "Reserva ABC123" }));
    const list = await oppTasks(oppId);
    expect(list.filter((x) => x.status === "cancelada")).toHaveLength(3);
    const open = list.filter((x) => x.status === "abierta");
    expect(open.map((x) => x.title)).toEqual(["Agradecer y pedir los datos de los viajeros", "Verificar requisitos: pasaporte con 6 meses de vigencia, visas, vacunas y seguro"]);
    // Reabrir cancela las de Ganado.
    await as(t.db, a.admin, async (tx) => moveOpportunity(tx, a.admin.id, a.id, oppId, { stageId: await stage(a, "Negociación"), reason: "El cliente cambió la fecha" }));
    const after = await oppTasks(oppId);
    expect(after.filter((x) => x.status === "abierta").map((x) => x.title)).toEqual(["Confirmar la opción elegida y la forma de pago"]);
  });

  it("la reactivación solo aplica con los motivos de su filtro (AC-226)", async () => {
    const a = await newAgency("Perder");
    const perdido = await stage(a, "Perdido");
    const contactado = await stage(a, "Contactado");
    const one = await newOpp(a, a.asesor, "Ana Precio", { stageId: contactado });
    await as(t.db, a.asesor, (tx) => moveOpportunity(tx, a.asesor.id, a.id, one.oppId, { stageId: perdido, lostReason: "precio" }));
    expect(await oppTasks(one.oppId)).toHaveLength(0);
    const two = await newOpp(a, a.asesor, "Beto Silencio", { stageId: contactado });
    await as(t.db, a.asesor, (tx) => moveOpportunity(tx, a.asesor.id, a.id, two.oppId, { stageId: perdido, lostReason: "sin_respuesta" }));
    const list = await oppTasks(two.oppId);
    expect(list).toHaveLength(1);
    expect(list[0].dueAt.getTime() - Date.now()).toBeGreaterThan(88 * 24 * 3600_000);
  });

  it("volver a una etapa con tareas abiertas no las duplica (AC-231)", async () => {
    const a = await newAgency("Duplicar");
    const { oppId } = await newOpp(a, a.asesor, "Rosa Díaz", { stageId: await stage(a, "Propuesta enviada") });
    await as(t.db, a.asesor, async (tx) => moveOpportunity(tx, a.asesor.id, a.id, oppId, { stageId: await stage(a, "Preparando propuesta") }));
    await as(t.db, a.asesor, async (tx) => moveOpportunity(tx, a.asesor.id, a.id, oppId, { stageId: await stage(a, "Propuesta enviada") }));
    const open = (await oppTasks(oppId)).filter((x) => x.status === "abierta");
    expect(open).toHaveLength(3);
  });

  it("al cambiar el responsable, sus tareas automáticas abiertas pasan al nuevo (AC-230)", async () => {
    const a = await newAgency("Responsable");
    const { oppId } = await newOpp(a, a.asesor, "Juan Ruiz");
    await as(t.db, a.asesor, (tx) => updateOpportunity(tx, a.asesor.id, a.id, oppId, { ownerId: a.asesor2.id, destination: "Cancún" }));
    const list = await oppTasks(oppId);
    expect(list).toHaveLength(4);
    expect(list.every((x) => x.assigneeId === a.asesor2.id)).toBe(true);
  });
});

describe("permisos de las tareas automáticas", () => {
  it("bloqueada: el asesor no la mueve ni la cancela, ni por la base; sí la completa; el admin sí la mueve (AC-227)", async () => {
    const a = await newAgency("Bloqueada");
    const tpl = await template(a, "Oportunidad nueva: contacto rápido");
    await as(t.db, a.admin, (tx) => updateTemplate(tx, a.admin.id, a.id, tpl.id, { name: tpl.name, trigger: "creada", stopStageId: tpl.stopStageId, editLevel: "bloqueada" }));
    const { oppId } = await newOpp(a, a.asesor, "Sara Gil");
    const [first, second] = await oppTasks(oppId);
    expect(first.editLevel).toBe("bloqueada");
    const later = new Date(first.dueAt.getTime() + 3600_000);
    await expectCode(as(t.db, a.asesor, (tx) => updateTask(tx, a.asesor.id, a.id, first.id, { dueAt: later })), "task_locked");
    await expectCode(as(t.db, a.asesor, (tx) => cancelTask(tx, a.asesor.id, a.id, first.id, "No aplica")), "task_locked");
    // Segunda barrera: la base rechaza el cambio aunque se salte el servidor.
    await expectDb(as(t.db, a.asesor, (tx) => tx.update(tasks).set({ dueAt: later }).where(eq(tasks.id, first.id))), "task_locked");
    await expectDb(as(t.db, a.asesor, (tx) => tx.update(tasks).set({ status: "cancelada", result: "x" }).where(eq(tasks.id, first.id))), "task_locked");
    await as(t.db, a.asesor, (tx) => completeTask(tx, a.asesor.id, a.id, first.id, "Le escribí y respondió"));
    await as(t.db, a.admin, (tx) => updateTask(tx, a.admin.id, a.id, second.id, { dueAt: later }));
    const [row] = await t.db.select().from(tasks).where(eq(tasks.id, second.id));
    expect(row.dueAt.toISOString()).toBe(later.toISOString());
  });

  it("ajustable: el asesor mueve la fecha y edita el mensaje, pero no reasigna ni cancela (AC-228)", async () => {
    const a = await newAgency("Ajustable");
    const { oppId } = await newOpp(a, a.asesor, "Hugo León");
    const [first] = await oppTasks(oppId);
    const later = new Date(first.dueAt.getTime() + 2 * 3600_000);
    await as(t.db, a.asesor, (tx) => updateTask(tx, a.asesor.id, a.id, first.id, { dueAt: later, message: "Hola {nombre}, ¿hablamos hoy?", priority: "media" }));
    const [row] = await t.db.select().from(tasks).where(eq(tasks.id, first.id));
    expect(row).toMatchObject({ message: "Hola {nombre}, ¿hablamos hoy?", priority: "media" });
    await expectCode(as(t.db, a.asesor, (tx) => updateTask(tx, a.asesor.id, a.id, first.id, { assigneeId: a.asesor2.id })), "task_locked");
    await expectCode(as(t.db, a.asesor, (tx) => cancelTask(tx, a.asesor.id, a.id, first.id, "No aplica")), "task_locked");
    await expectDb(as(t.db, a.asesor, (tx) => tx.update(tasks).set({ assigneeId: a.asesor2.id }).where(eq(tasks.id, first.id))), "task_locked");
  });

  it("un paso bloqueado manda sobre la plantilla libre", async () => {
    const a = await newAgency("Paso bloqueado");
    const tpl = await as(t.db, a.admin, (tx) => createTemplate(tx, a.admin.id, a.id, { name: "Libre con paso fijo", trigger: "creada", editLevel: "libre" }));
    await as(t.db, a.admin, (tx) => addStep(tx, a.admin.id, a.id, tpl, { kind: "llamada", title: "Llamada obligatoria", delayAmount: 0, delayUnit: "minutos", locked: true }));
    await as(t.db, a.admin, (tx) => addStep(tx, a.admin.id, a.id, tpl, { kind: "tarea", title: "Opcional", delayAmount: 1, delayUnit: "dias" }));
    const { oppId } = await newOpp(a, a.asesor, "Iván Soto");
    const mine = (await oppTasks(oppId)).filter((x) => x.templateId === tpl);
    expect(Object.fromEntries(mine.map((x) => [x.title, x.editLevel]))).toEqual({ "Llamada obligatoria": "bloqueada", Opcional: "libre" });
    const opcional = mine.find((x) => x.title === "Opcional")!;
    await as(t.db, a.asesor, (tx) => updateTask(tx, a.asesor.id, a.id, opcional.id, { assigneeId: a.asesor2.id }));
    await as(t.db, a.asesor, (tx) => cancelTask(tx, a.asesor.id, a.id, opcional.id, "Ya no hace falta"));
  });
});

describe("quién administra plantillas (AC-220, AC-229)", () => {
  it("un asesor no crea ni edita plantillas de la agencia, tampoco directo en la base", async () => {
    const a = await newAgency("Admin plantillas");
    await expectCode(as(t.db, a.asesor, (tx) => createTemplate(tx, a.asesor.id, a.id, { name: "Mía", trigger: "creada", editLevel: "libre" })), "permission_denied");
    const tpl = await template(a, "Negociación: cierre");
    await expectCode(as(t.db, a.asesor, (tx) => updateTemplate(tx, a.asesor.id, a.id, tpl.id, { name: "Cambio", trigger: "etapa", stageId: tpl.stageId, editLevel: "libre" })), "permission_denied");
    await expect(as(t.db, a.asesor, (tx) => tx.insert(followupTemplates).values({ agencyId: a.id, name: "X", trigger: "creada", createdBy: a.asesor.id }))).rejects.toThrow();
    const changed = await as(t.db, a.asesor, (tx) => tx.update(followupTemplates).set({ active: false }).where(eq(followupTemplates.id, tpl.id)).returning());
    expect(changed).toEqual([]);
  });

  it("plantillas personales: apagadas no se crean; encendidas solo aplican a las oportunidades de su dueño y nadie más las ve", async () => {
    const a = await newAgency("Personales");
    const input = { name: "Mi seguimiento VIP", trigger: "creada" as const, editLevel: "libre" as const, personal: true };
    await expectCode(as(t.db, a.asesor, (tx) => createTemplate(tx, a.asesor.id, a.id, input)), "personal_templates_off");
    await expect(as(t.db, a.asesor, (tx) => tx.insert(followupTemplates).values({ agencyId: a.id, name: "X", trigger: "creada", ownerId: a.asesor.id, createdBy: a.asesor.id }))).rejects.toThrow();

    await as(t.db, a.admin, (tx) => updateSettings(tx, a.admin.id, a.id, { weekdayStart: "08:00", weekdayEnd: "18:00", saturdayStart: "08:00", saturdayEnd: "12:00", allowPersonalTemplates: true }));
    const tpl = await as(t.db, a.asesor, (tx) => createTemplate(tx, a.asesor.id, a.id, input));
    await as(t.db, a.asesor, (tx) => addStep(tx, a.asesor.id, a.id, tpl, { kind: "llamada", title: "Llamada VIP", delayAmount: 30, delayUnit: "minutos" }));
    // El otro asesor no la ve ni la puede editar: para él no existe.
    const seen = await as(t.db, a.asesor2, (tx) => listTemplates(tx, a.asesor2.id, a.id));
    expect(seen.map((x) => x.id)).not.toContain(tpl);
    await expectCode(as(t.db, a.asesor2, (tx) => addStep(tx, a.asesor2.id, a.id, tpl, { kind: "tarea", title: "Intruso", delayAmount: 0, delayUnit: "minutos" })), "not_found");
    // El administrador sí la ve.
    expect((await as(t.db, a.admin, (tx) => listTemplates(tx, a.admin.id, a.id))).map((x) => x.id)).toContain(tpl);

    const mine = await newOpp(a, a.asesor, "Cliente de Ana");
    const other = await newOpp(a, a.asesor2, "Cliente de Luis");
    expect((await oppTasks(mine.oppId)).map((x) => x.title)).toContain("Llamada VIP");
    expect((await oppTasks(other.oppId)).map((x) => x.title)).not.toContain("Llamada VIP");
  });
});

describe("hallazgos de la prueba independiente", () => {
  it("con el responsable retirado, S02 ya exige reasignar antes de mover (RF-214); al reasignar, las tareas van al nuevo", async () => {
    const a = await newAgency("Revocado");
    const { oppId } = await newOpp(a, a.asesor2, "Cliente huérfano", { stageId: await stage(a, "Contactado") });
    await as(t.db, a.admin, (tx) => revokeMembership(tx, a.admin.id, a.id, a.asesor2.id));
    const propuesta = await stage(a, "Propuesta enviada");
    await expectCode(as(t.db, a.asesor, (tx) => moveOpportunity(tx, a.asesor.id, a.id, oppId, { stageId: propuesta })), "not_active_member");
    expect(await oppTasks(oppId)).toHaveLength(0);
    await as(t.db, a.asesor, (tx) => updateOpportunity(tx, a.asesor.id, a.id, oppId, { ownerId: a.asesor.id, destination: "Cancún" }));
    await as(t.db, a.asesor, (tx) => moveOpportunity(tx, a.asesor.id, a.id, oppId, { stageId: propuesta }));
    const list = await oppTasks(oppId);
    expect(list).toHaveLength(3);
    expect(list.every((x) => x.assigneeId === a.asesor.id)).toBe(true);
  });

  it("la espera de un paso tiene un tope por unidad, en el servidor y en la base", async () => {
    const a = await newAgency("Topes");
    const tpl = await as(t.db, a.admin, (tx) => createTemplate(tx, a.admin.id, a.id, { name: "Larga", trigger: "creada", editLevel: "libre" }));
    await expectCode(as(t.db, a.admin, (tx) => addStep(tx, a.admin.id, a.id, tpl, { kind: "tarea", title: "Muy lejos", delayAmount: 20000, delayUnit: "horas_habiles" })), "invalid_input");
    await expect(as(t.db, a.admin, (tx) => tx.insert(followupSteps).values({ agencyId: a.id, templateId: tpl, position: 0, kind: "tarea", title: "x", delayAmount: 20000, delayUnit: "horas_habiles" }))).rejects.toThrow();
    // El máximo permitido sigue funcionando.
    await as(t.db, a.admin, (tx) => addStep(tx, a.admin.id, a.id, tpl, { kind: "tarea", title: "Al tope", delayAmount: 2000, delayUnit: "horas_habiles" }));
    const { oppId } = await newOpp(a, a.asesor, "Paciente");
    expect((await oppTasks(oppId)).map((x) => x.title)).toContain("Al tope");
  });

  it("un asesor no reabre una tarea automática no libre que se canceló o completó", async () => {
    const a = await newAgency("Reabrir");
    const { oppId } = await newOpp(a, a.asesor, "Olga Paz");
    await as(t.db, a.asesor, async (tx) => moveOpportunity(tx, a.asesor.id, a.id, oppId, { stageId: await stage(a, "Contactado") }));
    const [cancelled] = await oppTasks(oppId);
    expect(cancelled.status).toBe("cancelada");
    await expectDb(as(t.db, a.asesor, (tx) => tx.update(tasks).set({ status: "abierta", result: null }).where(eq(tasks.id, cancelled.id))), "task_locked");
  });

  it("con las plantillas personales apagadas, las existentes dejan de aplicarse", async () => {
    const a = await newAgency("Apagar personales");
    const on = { weekdayStart: "08:00", weekdayEnd: "18:00", saturdayStart: "08:00", saturdayEnd: "12:00", allowPersonalTemplates: true };
    await as(t.db, a.admin, (tx) => updateSettings(tx, a.admin.id, a.id, on));
    const tpl = await as(t.db, a.asesor, (tx) => createTemplate(tx, a.asesor.id, a.id, { name: "VIP", trigger: "creada", editLevel: "libre", personal: true }));
    await as(t.db, a.asesor, (tx) => addStep(tx, a.asesor.id, a.id, tpl, { kind: "llamada", title: "Llamada VIP", delayAmount: 0, delayUnit: "minutos" }));
    await as(t.db, a.admin, (tx) => updateSettings(tx, a.admin.id, a.id, { ...on, allowPersonalTemplates: false }));
    const { oppId } = await newOpp(a, a.asesor, "Sin VIP");
    expect((await oppTasks(oppId)).map((x) => x.title)).not.toContain("Llamada VIP");
  });

  it("un asesor no escribe pasos de la agencia ni los ajustes directo en la base, y otra agencia no los lee", async () => {
    const a = await newAgency("Barreras");
    const b = await newAgency("Barreras B");
    const tpl = await template(a, "Negociación: cierre");
    await expect(as(t.db, a.asesor, (tx) => tx.insert(followupSteps).values({ agencyId: a.id, templateId: tpl.id, position: 9, kind: "tarea", title: "Intruso" }))).rejects.toThrow();
    expect(await as(t.db, a.asesor, (tx) => tx.update(followupSteps).set({ title: "Cambiado" }).where(eq(followupSteps.templateId, tpl.id)).returning())).toEqual([]);
    expect(await as(t.db, a.asesor, (tx) => tx.delete(followupSteps).where(eq(followupSteps.templateId, tpl.id)).returning())).toEqual([]);
    expect(await as(t.db, a.asesor, (tx) => tx.update(agencySettings).set({ allowPersonalTemplates: true }).where(eq(agencySettings.agencyId, a.id)).returning())).toEqual([]);
    expect(await as(t.db, b.admin, (tx) => tx.select().from(followupSteps).where(eq(followupSteps.agencyId, a.id)))).toEqual([]);
    expect(await as(t.db, b.admin, (tx) => tx.select().from(agencySettings).where(eq(agencySettings.agencyId, a.id)))).toEqual([]);
  });

  it("abrir una tarea de WhatsApp o correo rellena el mensaje, respeta el consentimiento y no sirve para tareas cerradas", async () => {
    const a = await newAgency("Abrir");
    const contactId = await as(t.db, a.asesor, (tx) => createContact(tx, a.asesor.id, a.id, { fullName: "Lucía Mar", phones: [{ raw: "310 555 0101" }], emails: ["lucia@ejemplo.test"] }));
    const oppId = await as(t.db, a.asesor, (tx) => createOpportunity(tx, a.asesor.id, a.id, { contactId, destination: "Lisboa" }));
    const list = await oppTasks(oppId);
    const wa = list.find((x) => x.kind === "whatsapp")!;
    const mail = list.find((x) => x.kind === "correo")!;
    const r1 = await as(t.db, a.asesor, (tx) => openTaskLink(tx, a.asesor.id, a.id, wa.id));
    expect(r1.channel).toBe("whatsapp");
    expect(decodeURIComponent(r1.link)).toContain("Hola Lucía, recibimos tu solicitud de viaje a Lisboa");
    const r2 = await as(t.db, a.asesor, (tx) => openTaskLink(tx, a.asesor.id, a.id, mail.id));
    expect(r2.link.startsWith("mailto:lucia@ejemplo.test?subject=")).toBe(true);
    await as(t.db, a.asesor, (tx) => recordConsent(tx, a.asesor.id, a.id, contactId, { channel: "correo", purpose: "servicio", status: "retirado", source: "Lo pidió por teléfono" }));
    await expectCode(as(t.db, a.asesor, (tx) => openTaskLink(tx, a.asesor.id, a.id, mail.id)), "email_blocked");
    await as(t.db, a.asesor, (tx) => completeTask(tx, a.asesor.id, a.id, wa.id, "Enviado"));
    await expectCode(as(t.db, a.asesor, (tx) => openTaskLink(tx, a.asesor.id, a.id, wa.id)), "not_found");
  });
});
