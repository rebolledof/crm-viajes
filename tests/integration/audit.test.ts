// Auditoría legible (informe de QA, 2 nov 2026): cada acción real del CRM se describe en español,
// con nombres en vez de ids y sin JSON; solo el administrador la lee y nunca la de otra agencia.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../../src/db/client";
import { acceptInvitation, changeMemberRole, createAgency, createInvitation, renameAgency, revokeInvitation, revokeMembership } from "../../src/server/agencies";
import { listAuditReadable } from "../../src/server/audit";
import { createContact, openWhatsapp, recordConsent, updateContact } from "../../src/server/contacts";
import { AppError } from "../../src/server/errors";
import { addStep, createTemplate, deleteStep, setTemplateActive, updateSettings, updateStep, updateTemplate } from "../../src/server/followups";
import { createOpportunity, createStage, listStages, moveOpportunity, reorderStages, updateOpportunity, updateStage } from "../../src/server/opportunities";
import { cancelTask, completeTask, createTask, updateTask } from "../../src/server/tasks";
import { as, createUser, testDb } from "./helpers";

const t = testDb();
let admin: SessionUser, asesor: SessionUser, otro: SessionUser, adminB: SessionUser;
let agency: string, agencyB: string;

beforeAll(async () => {
  admin = await createUser(t.admin, "aud-admin");
  asesor = await createUser(t.admin, "aud-ase");
  otro = await createUser(t.admin, "aud-otro");
  adminB = await createUser(t.admin, "aud-b");
  agency = await as(t.db, admin, (tx) => createAgency(tx, `Auditoría ${admin.id.slice(0, 6)}`));
  agencyB = await as(t.db, adminB, (tx) => createAgency(tx, `Auditoría B ${adminB.id.slice(0, 6)}`));
  for (const who of [asesor, otro]) {
    const inv = await as(t.db, admin, (tx) => createInvitation(tx, { userId: admin.id, agencyId: agency, email: who.email, role: "asesor", now: new Date() }));
    await as(t.db, who, (tx) => acceptInvitation(tx, inv.token));
  }
});

afterAll(() => t.close());

describe("auditoría legible", () => {
  it("todas las acciones de un día de trabajo se leen como frases en español, sin ids ni JSON", async () => {
    const pending = await as(t.db, admin, (tx) => createInvitation(tx, { userId: admin.id, agencyId: agency, email: "nadie@ejemplo.test", role: "lectura", now: new Date() }));
    await as(t.db, admin, (tx) => revokeInvitation(tx, admin.id, agency, pending.id));
    await as(t.db, admin, (tx) => renameAgency(tx, admin.id, agency, "Viajes Auditados"));
    await as(t.db, admin, (tx) => changeMemberRole(tx, admin.id, agency, otro.id, "lectura"));
    await as(t.db, admin, (tx) => revokeMembership(tx, admin.id, agency, otro.id));

    const stageId = await as(t.db, admin, (tx) => createStage(tx, admin.id, agency, { name: "Esperando pago", kind: "abierta" }));
    await as(t.db, admin, (tx) => updateStage(tx, admin.id, agency, stageId, { active: false }));
    await as(t.db, admin, (tx) => updateStage(tx, admin.id, agency, stageId, { active: true }));
    const stages = await as(t.db, admin, (tx) => listStages(tx, admin.id, agency, { includeInactive: true }));
    await as(t.db, admin, (tx) => reorderStages(tx, admin.id, agency, stages.map((s) => s.id).reverse()));

    const contactId = await as(t.db, asesor, (tx) => createContact(tx, asesor.id, agency, { fullName: "Carolina Duarte", phones: [{ raw: "311 222 3344" }], emails: [] }));
    await as(t.db, asesor, (tx) => updateContact(tx, asesor.id, agency, contactId, { fullName: "Carolina Duarte", phones: [{ raw: "311 222 3344" }], emails: [], ownerId: asesor.id }));
    await as(t.db, asesor, (tx) => openWhatsapp(tx, asesor.id, agency, contactId, { message: "Hola" }));
    await as(t.db, asesor, (tx) => recordConsent(tx, asesor.id, agency, contactId, { channel: "whatsapp", purpose: "servicio", status: "retirado", source: "Lo pidió" }));
    const oppId = await as(t.db, asesor, (tx) => createOpportunity(tx, asesor.id, agency, { contactId, destination: "Santa Marta" }));
    await as(t.db, asesor, (tx) => updateOpportunity(tx, asesor.id, agency, oppId, { destination: "Santa Marta", travelers: 2, ownerId: asesor.id }));
    const taskId = await as(t.db, asesor, (tx) => createTask(tx, asesor.id, agency, { contactId, opportunityId: oppId, kind: "llamada", title: "Confirmar fechas", dueAt: new Date() }));
    await as(t.db, asesor, (tx) => updateTask(tx, asesor.id, agency, taskId, { priority: "alta" }));
    await as(t.db, asesor, (tx) => completeTask(tx, asesor.id, agency, taskId, "Confirmó"));
    const t2 = await as(t.db, asesor, (tx) => createTask(tx, asesor.id, agency, { contactId, opportunityId: oppId, kind: "seguimiento", title: "Duplicada", dueAt: new Date() }));
    await as(t.db, asesor, (tx) => cancelTask(tx, asesor.id, agency, t2, "Se creó dos veces"));
    const perdido = stages.find((s) => s.kind === "perdida")!;
    await as(t.db, asesor, (tx) => moveOpportunity(tx, asesor.id, agency, oppId, { stageId: perdido.id, lostReason: "precio" }));

    const tpl = await as(t.db, admin, (tx) => createTemplate(tx, admin.id, agency, { name: "Recordatorio de pago", trigger: "etapa", stageId, editLevel: "ajustable" }));
    await as(t.db, admin, (tx) => updateTemplate(tx, admin.id, agency, tpl, { name: "Recordatorio de pago", trigger: "etapa", stageId, editLevel: "bloqueada" }));
    await as(t.db, admin, (tx) => setTemplateActive(tx, admin.id, agency, tpl, false));
    const step = await as(t.db, admin, (tx) => addStep(tx, admin.id, agency, tpl, { kind: "llamada", title: "Llamar por el pago", delayAmount: 1, delayUnit: "dias_habiles" }));
    await as(t.db, admin, (tx) => updateStep(tx, admin.id, agency, step, { kind: "llamada", title: "Llamar por el pago", delayAmount: 2, delayUnit: "dias_habiles" }));
    await as(t.db, admin, (tx) => deleteStep(tx, admin.id, agency, step));
    await as(t.db, admin, (tx) => updateSettings(tx, admin.id, agency, { weekdayStart: "08:00", weekdayEnd: "18:00", allowPersonalTemplates: true }));

    const events = await as(t.db, admin, (tx) => listAuditReadable(tx, admin.id, agency, 200));
    const actions = new Set(events.map((e) => e.action));
    for (const a of [
      "agency.created", "agency.renamed", "invitation.created", "invitation.revoked", "invitation.accepted", "membership.role_changed", "membership.revoked",
      "stage.created", "stage.updated", "stage.reordered", "contact.created", "contact.updated", "whatsapp.opened", "consent.recorded",
      "opportunity.created", "opportunity.updated", "opportunity.stage_changed", "followup.applied", "task.created", "task.updated", "task.completed", "task.cancelled",
      "followup.template_created", "followup.template_updated", "followup.step_created", "followup.step_updated", "followup.step_deleted", "settings.updated",
    ]) expect(actions, a).toContain(a);

    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-/i;
    for (const e of events) {
      const all = [e.description.text, ...e.description.details].join(" | ");
      expect(e.description.text, e.action).not.toMatch(/^Acción registrada/);
      expect(all, e.action).not.toMatch(uuid);
      expect(all, e.action).not.toMatch(/[{}"]/);
    }
    const texts = events.map((e) => e.description.text);
    expect(texts).toContain("Activó la etapa «Esperando pago»");
    expect(texts).toContain("Completó la tarea «Confirmar fechas»");
    expect(texts).toContain("Movió la oportunidad «Carolina Duarte · Santa Marta» de «Esperando pago» a «Perdido»");
    expect(texts).toContain("Desactivó la plantilla «Recordatorio de pago»");
    expect(events.find((e) => e.action === "followup.step_created")!.description.details).toContain("Cuándo: 1 día hábil después");
    expect(texts).toContain(`Quitó el acceso a ${otro.email}`);
  });

  it("un asesor no lee la auditoría y otra agencia no ve la de A", async () => {
    await expect(as(t.db, asesor, (tx) => listAuditReadable(tx, asesor.id, agency))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "permission_denied");
    await expect(as(t.db, adminB, (tx) => listAuditReadable(tx, adminB.id, agency))).rejects.toBeInstanceOf(AppError);
    const own = await as(t.db, adminB, (tx) => listAuditReadable(tx, adminB.id, agencyB));
    expect(own.map((e) => e.description.text).join(" ")).not.toContain("Carolina");
  });
});
