// SPEC-002 · Contactos, embudo por agencia, oportunidades, tareas y WhatsApp contra PostgreSQL real.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../../src/db/client";
import { activities, auditEvents, contactPhones, contacts, opportunities, pipelineStages, tasks } from "../../src/db/schema";
import { acceptInvitation, createAgency, createInvitation, revokeMembership } from "../../src/server/agencies";
import { createContact, getContactDetail, listContacts, openWhatsapp, recordConsent, updateContact } from "../../src/server/contacts";
import { AppError } from "../../src/server/errors";
import { createOpportunity, createStage, getOpportunity, listOpportunities, listStages, moveOpportunity, reorderStages, updateOpportunity, updateStage } from "../../src/server/opportunities";
import { completeTask, createTask, myDay } from "../../src/server/tasks";
import { as, createUser, testDb } from "./helpers";

const t = testDb();
let adminA: SessionUser, asesorA: SessionUser, lecturaA: SessionUser, exAsesorA: SessionUser, adminB: SessionUser;
let agencyA: string, agencyB: string;

async function join(by: SessionUser, agencyId: string, who: SessionUser, role: "admin" | "asesor" | "lectura") {
  const inv = await as(t.db, by, (tx) => createInvitation(tx, { userId: by.id, agencyId, email: who.email, role, now: new Date() }));
  await as(t.db, who, (tx) => acceptInvitation(tx, inv.token));
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function stageId(user: SessionUser, agencyId: string, name: string) {
  const stages = await as(t.db, user, (tx) => listStages(tx, user.id, agencyId, { includeInactive: true }));
  const s = stages.find((x) => x.name === name);
  if (!s) throw new Error(`sin etapa ${name}`);
  return s.id;
}

function newContact(user: SessionUser, agencyId: string, fullName: string, phone?: string, email?: string) {
  return as(t.db, user, (tx) => createContact(tx, user.id, agencyId, { fullName, phones: phone ? [{ raw: phone }] : [], emails: email ? [email] : [] }));
}

beforeAll(async () => {
  adminA = await createUser(t.admin, "admin-a");
  asesorA = await createUser(t.admin, "asesor-a");
  lecturaA = await createUser(t.admin, "lectura-a");
  exAsesorA = await createUser(t.admin, "ex-a");
  adminB = await createUser(t.admin, "admin-b");
  agencyA = await as(t.db, adminA, (tx) => createAgency(tx, "Viajes Andes CRM"));
  agencyB = await as(t.db, adminB, (tx) => createAgency(tx, "Caribe Tours CRM"));
  await join(adminA, agencyA, asesorA, "asesor");
  await join(adminA, agencyA, lecturaA, "lectura");
  await join(adminA, agencyA, exAsesorA, "asesor");
  await as(t.db, adminA, (tx) => revokeMembership(tx, adminA.id, agencyA, exAsesorA.id));
});

afterAll(() => t.close());

describe("etapas iniciales", () => {
  it("cada agencia nueva recibe las 10 etapas del briefing", async () => {
    const stages = await as(t.db, adminA, (tx) => listStages(tx, adminA.id, agencyA));
    expect(stages.map((s) => s.name)).toEqual([
      "Nuevo", "Pendiente de contacto", "Contactado", "En calificación", "Calificado",
      "Preparando propuesta", "Propuesta enviada", "Negociación", "Ganado", "Perdido",
    ]);
    expect(stages.filter((s) => s.kind !== "abierta").map((s) => s.kind)).toEqual(["ganada", "perdida"]);
  });
});

describe("aislamiento entre agencias (AC-201)", () => {
  it("la agencia B no ve ni modifica contactos, oportunidades, tareas ni historial de A", async () => {
    const cId = await newContact(asesorA, agencyA, "Laura Gómez", "310 111 2233");
    const oId = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, destination: "Cartagena" }));
    await as(t.db, asesorA, (tx) => createTask(tx, asesorA.id, agencyA, { contactId: cId, opportunityId: oId, kind: "llamada", title: "Llamar", dueAt: new Date() }));

    await expectCode(as(t.db, adminB, (tx) => getContactDetail(tx, adminB.id, agencyA, cId)), "not_found");
    await expectCode(as(t.db, adminB, (tx) => getContactDetail(tx, adminB.id, agencyB, cId)), "not_found");
    await expectCode(as(t.db, adminB, (tx) => getOpportunity(tx, adminB.id, agencyB, oId)), "not_found");

    const seen = await as(t.db, adminB, async (tx) => ({
      c: await tx.select().from(contacts).where(eq(contacts.id, cId)),
      p: await tx.select().from(contactPhones).where(eq(contactPhones.contactId, cId)),
      o: await tx.select().from(opportunities).where(eq(opportunities.id, oId)),
      t: await tx.select().from(tasks).where(eq(tasks.contactId, cId)),
      a: await tx.select().from(activities).where(eq(activities.contactId, cId)),
      s: await tx.select().from(pipelineStages).where(eq(pipelineStages.agencyId, agencyA)),
    }));
    expect(seen).toEqual({ c: [], p: [], o: [], t: [], a: [], s: [] });

    const touched = await as(t.db, adminB, (tx) => tx.update(contacts).set({ fullName: "Hackeado" }).where(eq(contacts.id, cId)).returning());
    expect(touched).toEqual([]);
  });

  it("no se puede crear en B una oportunidad que apunte a un contacto o etapa de A", async () => {
    const cId = await newContact(asesorA, agencyA, "Pedro Ruiz");
    const stageB = await stageId(adminB, agencyB, "Nuevo");
    await expectCode(as(t.db, adminB, (tx) => createOpportunity(tx, adminB.id, agencyB, { contactId: cId })), "not_found");
    await expect(
      as(t.db, adminB, (tx) => tx.insert(opportunities).values({ agencyId: agencyB, contactId: cId, stageId: stageB, createdBy: adminB.id })),
    ).rejects.toThrow();
  });
});

describe("roles (AC-202)", () => {
  it("lectura consulta pero no cambia etapas, ni llamando a la acción ni con SQL", async () => {
    const cId = await newContact(asesorA, agencyA, "Sofía León");
    const oId = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId }));
    const contactado = await stageId(lecturaA, agencyA, "Contactado");
    expect((await as(t.db, lecturaA, (tx) => getOpportunity(tx, lecturaA.id, agencyA, oId))).stageName).toBe("Nuevo");
    await expectCode(as(t.db, lecturaA, (tx) => moveOpportunity(tx, lecturaA.id, agencyA, oId, { stageId: contactado })), "permission_denied");
    const rows = await as(t.db, lecturaA, (tx) => tx.update(opportunities).set({ stageId: contactado }).where(eq(opportunities.id, oId)).returning());
    expect(rows).toEqual([]);
    await expectCode(newContact(lecturaA, agencyA, "No debería"), "permission_denied");
  });
});

describe("contactos y duplicados (AC-203)", () => {
  it("el mismo teléfono escrito distinto se detecta como duplicado y se ofrece el existente", async () => {
    const first = await newContact(asesorA, agencyA, "Camila Torres", "300 000 0000");
    const err = await newContact(adminA, agencyA, "Camila T.", "+57 300-000-0000").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("duplicate_contact");
    expect(err.detail).toBe(first);
  });

  it("el mismo correo con mayúsculas también es duplicado; en otra agencia no", async () => {
    await newContact(asesorA, agencyA, "Andrés Mora", undefined, "andres@ejemplo.test");
    await expectCode(newContact(asesorA, agencyA, "Andrés", undefined, "ANDRES@Ejemplo.test"), "duplicate_contact");
    await expect(newContact(adminB, agencyB, "Andrés Mora", "300 000 0000", "andres@ejemplo.test")).resolves.toBeTypeOf("string");
  });

  it("teléfono inválido se rechaza", async () => {
    await expectCode(newContact(asesorA, agencyA, "Mal número", "123"), "invalid_phone");
  });

  it("editar conserva el contacto y busca por teléfono normalizado", async () => {
    const id = await newContact(asesorA, agencyA, "Valentina Ríos", "315 222 3344");
    await as(t.db, asesorA, (tx) => updateContact(tx, asesorA.id, agencyA, id, { fullName: "Valentina Ríos", phones: [{ raw: "3152223344" }, { raw: "+1 415 555 2671" }], emails: ["vale@ejemplo.test"], ownerId: asesorA.id }));
    const found = await as(t.db, asesorA, (tx) => listContacts(tx, asesorA.id, agencyA, "+57 315 222 3344"));
    expect(found.map((c) => c.id)).toEqual([id]);
    expect(found[0].phone).toBe("+573152223344");
  });
});

describe("oportunidades (AC-204, AC-205, AC-206)", () => {
  it("una segunda oportunidad no cambia la primera", async () => {
    const cId = await newContact(asesorA, agencyA, "Julián Paz", "301 555 6677");
    const cartagena = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, destination: "Cartagena", travelers: 2 }));
    const before = await as(t.db, asesorA, (tx) => getOpportunity(tx, asesorA.id, agencyA, cartagena));
    await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, destination: "Madrid" }));
    const after = await as(t.db, asesorA, (tx) => getOpportunity(tx, asesorA.id, agencyA, cartagena));
    expect(after.opp).toEqual(before.opp);
    const detail = await as(t.db, asesorA, (tx) => getContactDetail(tx, asesorA.id, agencyA, cId));
    expect(detail.opportunities.map((o) => o.destination).sort()).toEqual(["Cartagena", "Madrid"]);
  });

  it("lo que no se sabe queda vacío, sin inferencias", async () => {
    const cId = await newContact(asesorA, agencyA, "Mateo Díaz");
    const oId = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, destination: "San Andrés" }));
    const { opp } = await as(t.db, asesorA, (tx) => getOpportunity(tx, asesorA.id, agencyA, oId));
    expect(opp).toMatchObject({ travelStart: null, travelEnd: null, dateFlexibility: null, travelers: null, budgetAmount: null, budgetCurrency: null });
  });

  it("presupuesto sin moneda se rechaza, en la aplicación y en la base", async () => {
    const cId = await newContact(asesorA, agencyA, "Isabel Vega");
    await expectCode(as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, budgetAmount: "4.500.000" })), "invalid_amount");
    const nuevo = await stageId(asesorA, agencyA, "Nuevo");
    await expect(
      as(t.db, asesorA, (tx) => tx.insert(opportunities).values({ agencyId: agencyA, contactId: cId, stageId: nuevo, createdBy: asesorA.id, budgetAmount: "4500000" })),
    ).rejects.toThrow();
    const oId = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, budgetAmount: "4.500.000", budgetCurrency: "COP" }));
    const { opp } = await as(t.db, asesorA, (tx) => getOpportunity(tx, asesorA.id, agencyA, oId));
    expect(opp).toMatchObject({ budgetAmount: "4500000.00", budgetCurrency: "COP" });
  });
});

describe("cierre, saltos y reapertura (AC-207, AC-208, AC-212, AC-216)", () => {
  let cId: string, oId: string;
  beforeAll(async () => {
    cId = await newContact(asesorA, agencyA, "Ana Beltrán", "320 444 5566");
    oId = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, destination: "Lima" }));
  });

  it("perdida sin motivo, u 'otro' sin nota, se rechaza también en la base", async () => {
    const perdido = await stageId(asesorA, agencyA, "Perdido");
    await expectCode(as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, oId, { stageId: perdido })), "lost_reason_required");
    await expectCode(as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, oId, { stageId: perdido, lostReason: "otro" })), "lost_note_required");
    await expect(as(t.db, asesorA, (tx) => tx.update(opportunities).set({ stageId: perdido }).where(eq(opportunities.id, oId)))).rejects.toThrow();
  });

  it("ganada sin evidencia se rechaza", async () => {
    const ganado = await stageId(asesorA, agencyA, "Ganado");
    await expectCode(as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, oId, { stageId: ganado, wonEvidence: " " })), "won_evidence_required");
  });

  it("se puede saltar de Nuevo a Propuesta enviada y queda en el historial y la auditoría con quién lo hizo", async () => {
    const enviada = await stageId(asesorA, agencyA, "Propuesta enviada");
    await as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, oId, { stageId: enviada }));
    const hist = await t.admin`select actor_id, data from public.activities where opportunity_id = ${oId} and kind = 'oportunidad.etapa'`;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ actor_id: asesorA.id, data: { de: "Nuevo", a: "Propuesta enviada" } });
    const audit = await as(t.db, adminA, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.objectId, oId)));
    expect(audit.find((a) => a.action === "opportunity.stage_changed")).toMatchObject({ actorId: asesorA.id, changes: { de: "Nuevo", a: "Propuesta enviada" } });
  });

  it("ganar con evidencia cierra; reabrir exige motivo y limpia el cierre", async () => {
    const ganado = await stageId(asesorA, agencyA, "Ganado");
    const negociacion = await stageId(asesorA, agencyA, "Negociación");
    await as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, oId, { stageId: ganado, wonEvidence: "Reserva LATAM ABC123" }));
    let { opp } = await as(t.db, asesorA, (tx) => getOpportunity(tx, asesorA.id, agencyA, oId));
    expect(opp.wonEvidence).toBe("Reserva LATAM ABC123");
    expect(opp.closedAt).not.toBeNull();
    await expectCode(as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, oId, { stageId: negociacion })), "reopen_reason_required");
    await as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, oId, { stageId: negociacion, reason: "El cliente cambió la fecha" }));
    ({ opp } = await as(t.db, asesorA, (tx) => getOpportunity(tx, asesorA.id, agencyA, oId)));
    expect(opp).toMatchObject({ wonEvidence: null, closedAt: null });
  });
});

describe("tareas y Mi día (AC-209, AC-210, AC-213)", () => {
  it("una oportunidad abierta sin tareas aparece en Mi día de su responsable; con tarea, no", async () => {
    const cId = await newContact(asesorA, agencyA, "Ricardo Silva");
    const oId = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, destination: "Cusco" }));
    let day = await as(t.db, asesorA, (tx) => myDay(tx, asesorA.id, agencyA, new Date()));
    expect(day.withoutNextAction.map((o) => o.id)).toContain(oId);
    const due = new Date(Date.now() - 60_000);
    const taskId = await as(t.db, asesorA, (tx) => createTask(tx, asesorA.id, agencyA, { contactId: cId, opportunityId: oId, kind: "seguimiento", title: "Enviar opciones", dueAt: due }));
    day = await as(t.db, asesorA, (tx) => myDay(tx, asesorA.id, agencyA, new Date()));
    expect(day.withoutNextAction.map((o) => o.id)).not.toContain(oId);
    expect(day.due.map((d) => d.task.id)).toContain(taskId);
    const board = await as(t.db, asesorA, (tx) => listOpportunities(tx, asesorA.id, agencyA, { ownerId: asesorA.id }));
    expect(board.find((o) => o.id === oId)).toMatchObject({ contactName: "Ricardo Silva", nextActionTitle: "Enviar opciones", stageKind: "abierta" });
    const other = await as(t.db, adminA, (tx) => myDay(tx, adminA.id, agencyA, new Date()));
    expect(other.due.map((d) => d.task.id)).not.toContain(taskId);
  });

  it("completar sin resultado se rechaza, también en la base", async () => {
    const cId = await newContact(asesorA, agencyA, "Elena Castro");
    const taskId = await as(t.db, asesorA, (tx) => createTask(tx, asesorA.id, agencyA, { contactId: cId, kind: "llamada", title: "Llamar", dueAt: new Date() }));
    await expectCode(as(t.db, asesorA, (tx) => completeTask(tx, asesorA.id, agencyA, taskId, "  ")), "result_required");
    await expect(as(t.db, asesorA, (tx) => tx.update(tasks).set({ status: "completada", completedAt: new Date() }).where(eq(tasks.id, taskId)))).rejects.toThrow();
    await as(t.db, asesorA, (tx) => completeTask(tx, asesorA.id, agencyA, taskId, "Contestó, quiere ir en diciembre"));
    const [row] = await t.admin`select status, result from public.tasks where id = ${taskId}`;
    expect(row).toEqual({ status: "completada", result: "Contestó, quiere ir en diciembre" });
  });

  it("no se asignan tareas ni oportunidades a quien no es miembro activo", async () => {
    const cId = await newContact(asesorA, agencyA, "Gabriel Rojas");
    await expectCode(as(t.db, asesorA, (tx) => createTask(tx, asesorA.id, agencyA, { contactId: cId, kind: "llamada", title: "x", assigneeId: exAsesorA.id, dueAt: new Date() })), "not_active_member");
    await expectCode(as(t.db, asesorA, (tx) => createTask(tx, asesorA.id, agencyA, { contactId: cId, kind: "llamada", title: "x", assigneeId: adminB.id, dueAt: new Date() })), "not_active_member");
    await expectCode(as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId, ownerId: adminB.id })), "not_active_member");
    const oId = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId }));
    await expectCode(as(t.db, asesorA, (tx) => updateOpportunity(tx, asesorA.id, agencyA, oId, { ownerId: exAsesorA.id })), "not_active_member");
  });
});

describe("botón de WhatsApp y consentimiento (AC-211)", () => {
  it("abre el enlace y lo registra; con el permiso retirado no se ofrece", async () => {
    const cId = await newContact(asesorA, agencyA, "Lucía Ortega", "302 777 8899");
    const link = await as(t.db, asesorA, (tx) => openWhatsapp(tx, asesorA.id, agencyA, cId, { message: "Hola Lucía" }));
    expect(link).toBe("https://wa.me/573027778899?text=Hola%20Luc%C3%ADa");
    const [act] = await t.admin`select kind, actor_id from public.activities where contact_id = ${cId} and kind = 'whatsapp.abierto'`;
    expect(act).toEqual({ kind: "whatsapp.abierto", actor_id: asesorA.id });

    await as(t.db, asesorA, (tx) => recordConsent(tx, asesorA.id, agencyA, cId, { channel: "whatsapp", purpose: "servicio", status: "retirado", source: "Lo pidió por teléfono" }));
    await expectCode(as(t.db, asesorA, (tx) => openWhatsapp(tx, asesorA.id, agencyA, cId, { message: "Hola" })), "whatsapp_blocked");
    const detail = await as(t.db, asesorA, (tx) => getContactDetail(tx, asesorA.id, agencyA, cId));
    expect(detail.consents).toMatchObject([{ channel: "whatsapp", purpose: "servicio", status: "retirado" }]);

    await as(t.db, asesorA, (tx) => recordConsent(tx, asesorA.id, agencyA, cId, { channel: "whatsapp", purpose: "servicio", status: "otorgado", source: "Volvió a escribir" }));
    await expect(as(t.db, asesorA, (tx) => openWhatsapp(tx, asesorA.id, agencyA, cId, { message: "Hola" }))).resolves.toContain("wa.me");
    const [{ n }] = await t.admin`select count(*)::int as n from public.contact_consents where contact_id = ${cId}`;
    expect(n).toBe(2);
  });

  it("sin teléfono avisa que no hay número", async () => {
    const cId = await newContact(asesorA, agencyA, "Sin Teléfono", undefined, "sintel@ejemplo.test");
    await expectCode(as(t.db, asesorA, (tx) => openWhatsapp(tx, asesorA.id, agencyA, cId, { message: "Hola" })), "no_phone");
  });
});

describe("etapas propias de cada agencia (AC-214 a AC-217)", () => {
  it("renombrar en A no afecta a B, y un asesor no puede renombrar", async () => {
    const enCalif = await stageId(adminA, agencyA, "En calificación");
    await as(t.db, adminA, (tx) => updateStage(tx, adminA.id, agencyA, enCalif, { name: "Perfilando" }));
    expect((await as(t.db, adminB, (tx) => listStages(tx, adminB.id, agencyB))).map((s) => s.name)).toContain("En calificación");
    await expectCode(as(t.db, asesorA, (tx) => updateStage(tx, asesorA.id, agencyA, enCalif, { name: "Otra" })), "permission_denied");
    const rows = await as(t.db, asesorA, (tx) => tx.update(pipelineStages).set({ name: "Otra" }).where(eq(pipelineStages.id, enCalif)).returning());
    expect(rows).toEqual([]);
  });

  it("no se puede desactivar la única etapa ganada, ni en la base", async () => {
    const ganado = await stageId(adminA, agencyA, "Ganado");
    await expectCode(as(t.db, adminA, (tx) => updateStage(tx, adminA.id, agencyA, ganado, { active: false })), "last_stage_of_kind");
    await expect(as(t.db, adminA, (tx) => tx.update(pipelineStages).set({ active: false }).where(eq(pipelineStages.id, ganado)))).rejects.toThrow();
  });

  it("desactivar una etapa deja sus oportunidades donde están y ya no se ofrece", async () => {
    const neg = await stageId(adminA, agencyA, "Negociación");
    const ids: string[] = [];
    for (const n of ["Uno", "Dos", "Tres"]) {
      const cId = await newContact(asesorA, agencyA, `Cliente ${n}`);
      const oId = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId }));
      await as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, oId, { stageId: neg }));
      ids.push(oId);
    }
    await as(t.db, adminA, (tx) => updateStage(tx, adminA.id, agencyA, neg, { active: false }));
    for (const id of ids) expect((await as(t.db, asesorA, (tx) => getOpportunity(tx, asesorA.id, agencyA, id))).opp.stageId).toBe(neg);
    expect((await as(t.db, asesorA, (tx) => listStages(tx, asesorA.id, agencyA))).map((s) => s.id)).not.toContain(neg);
    const cId = await newContact(asesorA, agencyA, "Cliente Cuatro");
    const other = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cId }));
    await expectCode(as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, other, { stageId: neg })), "stage_inactive");
    // Editar una oportunidad que sigue en la etapa desactivada no falla.
    await as(t.db, asesorA, (tx) => updateOpportunity(tx, asesorA.id, agencyA, ids[0], { destination: "Bogotá", ownerId: asesorA.id }));
  });

  it("el administrador crea etapas, evita nombres repetidos y reordena", async () => {
    const id = await as(t.db, adminA, (tx) => createStage(tx, adminA.id, agencyA, { name: "Esperando pago", kind: "abierta" }));
    await expectCode(as(t.db, adminA, (tx) => createStage(tx, adminA.id, agencyA, { name: "esperando pago ", kind: "abierta" })), "stage_name_taken");
    const all = await as(t.db, adminA, (tx) => listStages(tx, adminA.id, agencyA, { includeInactive: true }));
    const order = [id, ...all.map((s) => s.id).filter((x) => x !== id)];
    await as(t.db, adminA, (tx) => reorderStages(tx, adminA.id, agencyA, order));
    expect((await as(t.db, adminA, (tx) => listStages(tx, adminA.id, agencyA, { includeInactive: true })))[0].name).toBe("Esperando pago");
  });
});
