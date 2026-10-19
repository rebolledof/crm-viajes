import Link from "next/link";
import { Notice, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { LOSS_REASON_LABELS, STAGE_KIND_LABELS } from "@/domain/pipeline";
import { can } from "@/domain/permissions";
import { PRIORITY_LABELS } from "@/domain/tasks";
import { whatsappAllowed } from "@/domain/whatsapp";
import { getContactDetail, whatsappDraft } from "@/server/contacts";
import { getOpportunity, listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { Flash, NewTaskForm, TaskItem, budget, fechaHora, formatDay, loadOr404, memberName, type SearchParams } from "../../crm-ui";
import { WhatsappButton } from "../../contactos/whatsapp-button";
import { MoveForm } from "../move-form";

const UNKNOWN = "Desconocido";

export default async function OportunidadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const { id } = await params;
  const sp = await searchParams;
  const [data, stages, members] = await loadOr404(id, () =>
    withUser(getDb(), user, (tx) => Promise.all([getOpportunity(tx, user.id, active.agencyId, id), listStages(tx, user.id, active.agencyId), activeMembers(tx, user.id, active.agencyId)])),
  );
  const o = data.opp;
  const [contact, draft] = await withUser(getDb(), user, (tx) =>
    Promise.all([getContactDetail(tx, user.id, active.agencyId, o.contactId), whatsappDraft(tx, active.agencyId, o.contactId, o.id)]),
  );
  const canWrite = can(active.role, "crm.write");
  const now = new Date();
  const back = `/app/oportunidades/${o.id}`;
  const rows: [string, string][] = [
    ["Destino", o.destination || UNKNOWN],
    ["Producto", o.product || UNKNOWN],
    ["Fechas", o.travelStart ? `${formatDay(o.travelStart)}${o.travelEnd ? ` al ${formatDay(o.travelEnd)}` : ""}` : UNKNOWN],
    ["Flexibilidad", o.dateFlexibility || UNKNOWN],
    ["Viajeros", o.travelers ? String(o.travelers) : UNKNOWN],
    ["Presupuesto", budget(o.budgetAmount, o.budgetCurrency) || UNKNOWN],
    ["Prioridad", PRIORITY_LABELS[o.priority]],
    ["Responsable", memberName(members, o.ownerId)],
    ["Origen", o.source || UNKNOWN],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link href="/app/oportunidades" className={linkButtonClass}>Oportunidades</Link>
            {" · "}
            <Link href={`/app/contactos/${o.contactId}`} className={linkButtonClass}>{data.contactName}</Link>
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">{o.destination || "Destino desconocido"}</h1>
          <p className="text-sm text-slate-600">
            Etapa: <strong>{data.stageName}</strong> ({STAGE_KIND_LABELS[data.stageKind]})
            {o.closedAt && ` · cerrada el ${fechaHora.format(o.closedAt)}`}
          </p>
        </div>
        {canWrite && <Link href={`${back}/editar`} className={linkButtonClass}>Editar datos</Link>}
      </div>
      <Flash sp={sp} />
      {data.stageKind === "perdida" && o.lostReason && (
        <Notice>Motivo de pérdida: {LOSS_REASON_LABELS[o.lostReason]}{o.lostNote && `. ${o.lostNote}`}</Notice>
      )}
      {data.stageKind === "ganada" && o.wonEvidence && <Notice tone="ok">Evidencia: {o.wonEvidence}</Notice>}

      {canWrite && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-900">Cambiar etapa</h2>
          <MoveForm opportunityId={o.id} currentStageId={o.stageId} currentKind={data.stageKind} stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))} back={back} />
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className={v === UNKNOWN ? "italic text-slate-400" : "text-slate-900"}>{v}</dd>
            </div>
          ))}
        </dl>
        {o.notes && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{o.notes}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Próximas acciones</h2>
        {data.openTasks.length === 0 ? (
          data.stageKind === "abierta" ? <Notice tone="error">Sin próxima acción. Crea una tarea para no perder el seguimiento.</Notice> : <Notice>No hay tareas abiertas.</Notice>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.openTasks.map((t) => (
              <TaskItem key={t.id} task={t} now={now} back={back} canWrite={canWrite} members={members} />
            ))}
          </ul>
        )}
        {canWrite && (
          <details className="rounded-lg border border-slate-200 bg-white p-4" open={data.openTasks.length === 0 && data.stageKind === "abierta"}>
            <summary className="cursor-pointer text-sm font-medium text-sky-700">Nueva tarea</summary>
            <div className="mt-3">
              <NewTaskForm contactId={o.contactId} opportunityId={o.id} members={members} userId={user.id} back={back} now={now} />
            </div>
          </details>
        )}
      </section>

      {canWrite && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-900">WhatsApp</h2>
          {contact.phones.length === 0 ? (
            <Notice>El contacto no tiene teléfono.</Notice>
          ) : !whatsappAllowed(contact.consents) ? (
            <Notice tone="error">El contacto retiró el permiso de WhatsApp para atención del viaje.</Notice>
          ) : (
            <WhatsappButton contactId={o.contactId} opportunityId={o.id} draft={draft} />
          )}
          <p className="mt-2 text-xs text-slate-500">El historial completo está en la ficha del contacto.</p>
        </section>
      )}
    </div>
  );
}
