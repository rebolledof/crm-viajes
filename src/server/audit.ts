// Auditoría legible (informe de QA, 2 nov 2026): los eventos con los nombres de lo que tocaron.
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { contacts, followupTemplates, opportunities, pipelineStages, tasks } from "@/db/schema";
import { describeAudit, type AuditDescription } from "@/domain/audit";
import { listAudit, listMembers } from "./agencies";

type Row = { id: string; name: string };

function lookup(rows: Row[]) {
  const m = new Map(rows.map((r) => [r.id, r.name]));
  return (id: string) => m.get(id);
}

/** Los últimos eventos de la agencia, cada uno con su frase y sus detalles en español. */
export async function listAuditReadable(tx: Tx, userId: string, agencyId: string, limit = 100) {
  const events = await listAudit(tx, userId, agencyId, limit);
  const ids = (type: string, extra: (c: Record<string, unknown>) => unknown[] = () => []) => [
    ...new Set(
      events
        .flatMap((e) => [e.objectType === type ? e.objectId : null, ...extra(e.changes)])
        .filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)),
    ),
  ];
  const stageIds = ids("stage", (c) => [c.stageId, c.stopStageId]);
  const contactIds = ids("contact", (c) => [c.contactId]);
  const oppIds = ids("opportunity");
  const taskIds = ids("task");
  const templateIds = ids("followup_template", (c) => [c.template]);
  const none = Promise.resolve([] as Row[]);
  const [members, stages, contactRows, opps, taskRows, templates] = await Promise.all([
    listMembers(tx, agencyId),
    stageIds.length ? tx.select({ id: pipelineStages.id, name: pipelineStages.name }).from(pipelineStages).where(and(eq(pipelineStages.agencyId, agencyId), inArray(pipelineStages.id, stageIds))) : none,
    contactIds.length ? tx.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(and(eq(contacts.agencyId, agencyId), inArray(contacts.id, contactIds))) : none,
    oppIds.length
      ? tx
          .select({ id: opportunities.id, contact: contacts.fullName, destination: opportunities.destination })
          .from(opportunities)
          .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
          .where(and(eq(opportunities.agencyId, agencyId), inArray(opportunities.id, oppIds)))
          .then((rows) => rows.map((r) => ({ id: r.id, name: `${r.contact} · ${r.destination || "sin destino"}` })))
      : none,
    taskIds.length ? tx.select({ id: tasks.id, name: tasks.title }).from(tasks).where(and(eq(tasks.agencyId, agencyId), inArray(tasks.id, taskIds))) : none,
    templateIds.length ? tx.select({ id: followupTemplates.id, name: followupTemplates.name }).from(followupTemplates).where(and(eq(followupTemplates.agencyId, agencyId), inArray(followupTemplates.id, templateIds))) : none,
  ]);
  const names = {
    member: lookup(members.map((m) => ({ id: m.userId, name: m.email }))),
    stage: lookup(stages),
    contact: lookup(contactRows),
    opportunity: lookup(opps),
    task: lookup(taskRows),
    template: lookup(templates),
  };
  return events.map((e) => ({ ...e, description: describeAudit(e, names) as AuditDescription }));
}
