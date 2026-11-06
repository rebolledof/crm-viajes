import { firstParams } from "@/domain/params";
import Link from "next/link";
import { Card, Notice, PageHeader, linkButtonClass, secondaryButtonClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import { stagePath } from "@/domain/guide";
import { getDb, withUser } from "@/db/client";
import { LOSS_REASON_LABELS, STAGE_KIND_LABELS } from "@/domain/pipeline";
import { can } from "@/domain/permissions";
import { PRIORITY_LABELS } from "@/domain/tasks";
import { whatsappAllowed } from "@/domain/whatsapp";
import { getContactDetail, whatsappDraft } from "@/server/contacts";
import { getOpportunity, listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { activeMembers, contactChannels } from "@/server/tasks";
import { Flash, NewTaskForm, TaskItem, budget, fechaHora, formatDay, loadOr404, memberName, type SearchParams } from "../../crm-ui";
import { WhatsappButton } from "../../contactos/whatsapp-button";
import { MoveForm } from "../move-form";
import { StagePath } from "../../stage-path";
import { listOpportunityQuotes } from "@/server/quotes";
import { QuotesCard } from "./quotes-card";

const UNKNOWN = "Desconocido";

export default async function OportunidadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const { id } = await params;
  const sp = firstParams(await searchParams);
  const [data, stages, members] = await loadOr404(id, () =>
    withUser(getDb(), user, (tx) => Promise.all([getOpportunity(tx, user.id, active.agencyId, id), listStages(tx, user.id, active.agencyId), activeMembers(tx, user.id, active.agencyId)])),
  );
  const o = data.opp;
  const [contact, draft, channels, quotesList] = await withUser(getDb(), user, (tx) =>
    Promise.all([
      getContactDetail(tx, user.id, active.agencyId, o.contactId),
      whatsappDraft(tx, active.agencyId, o.contactId, o.id),
      contactChannels(tx, user.id, active.agencyId, [o.contactId]),
      listOpportunityQuotes(tx, user.id, active.agencyId, o.id, new Date()),
    ]),
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

  const path = stagePath(stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })), { stageId: o.stageId, kind: data.stageKind });
  const goal = stages.find((s) => s.id === o.stageId)?.goal;
  const open = data.stageKind === "abierta";
  const [next, ...rest] = data.openTasks;
  const askNext = open && !next && sp.siguiente === "1";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="plane"
        eyebrow={
          <>
            <Link href="/app/oportunidades" className={linkButtonClass}>Oportunidades</Link>
            {" / "}
            <Link href={`/app/contactos/${o.contactId}`} className={linkButtonClass}>{data.contactName}</Link>
          </>
        }
        title={o.destination || "Destino sin definir"}
        actions={canWrite && <Link href={`${back}/editar`} className={secondaryButtonClass}>Editar datos</Link>}
      >
        <p className="text-sm text-slate-600">
          {STAGE_KIND_LABELS[data.stageKind]} · {memberName(members, o.ownerId)}
          {o.closedAt && ` · cerrada el ${fechaHora.format(o.closedAt)}`}
        </p>
      </PageHeader>
      <Flash sp={sp} />

      <Card bodyClassName="p-4 flex flex-col gap-3">
        <StagePath items={path} />
        <p className="text-sm text-slate-700">
          <Icon name="flag" className="mr-1 inline size-4 align-[-3px] text-accent-text" />
          Etapa actual: <strong>{data.stageName}</strong>
          {open && path.findIndex((p) => p.state === "actual") >= 0 && ` (paso ${path.findIndex((p) => p.state === "actual") + 1} de ${path.length})`}
          {goal ? <> · Meta: {goal}</> : open ? " · Cuando cumplas lo de esta etapa, pásala a la siguiente." : ""}
        </p>
      </Card>
      {data.stageKind === "perdida" && o.lostReason && (
        <Notice>Motivo de pérdida: {LOSS_REASON_LABELS[o.lostReason]}{o.lostNote && `. ${o.lostNote}`}</Notice>
      )}
      {data.stageKind === "ganada" && o.wonEvidence && <Notice tone="ok">Evidencia: {o.wonEvidence}</Notice>}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {askNext && canWrite && (
            <section id="siguiente-paso" className="rounded border-2 border-accent bg-surface p-4 shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
              <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                <Icon name="arrow" className="size-5 text-accent-text" />
                ¿Cuál es el siguiente paso con {data.contactName}?
              </h2>
              <p className="mt-1 mb-3 text-sm text-slate-600">Terminaste la última tarea de esta oportunidad. Programa lo que sigue para que no se quede sin seguimiento.</p>
              <NewTaskForm contactId={o.contactId} opportunityId={o.id} members={members} userId={user.id} back={back} now={now} />
              <p className="mt-3 text-sm text-slate-600">
                ¿Todavía no sabes qué sigue?{" "}
                <Link href={back} className={linkButtonClass}>Lo defino después</Link>
                {" "}y la oportunidad quedará en «Sin siguiente paso» de Mi día para que no se olvide.
              </p>
            </section>
          )}

          {!askNext && (
          <Card title="Qué hacer ahora" icon="check" bodyClassName="px-4">
            {next ? (
              <ul>
                <TaskItem task={next} now={now} back={back} role={active.role} members={members} channels={channels} primary />
              </ul>
            ) : (
              <div className="py-4">
                {open ? (
                  <Notice tone="error">Esta oportunidad no tiene siguiente paso. {canWrite ? "Crea una tarea abajo para no perder el seguimiento." : "Pídele al responsable que programe una tarea."}</Notice>
                ) : (
                  <Notice>La oportunidad está cerrada y no tiene tareas abiertas.</Notice>
                )}
              </div>
            )}
          </Card>
          )}

          <QuotesCard opportunityId={o.id} quotes={quotesList} canCreate={can(active.role, "quotes.write")} members={members} />

          {rest.length > 0 && (
            <Card title={`Después (${rest.length})`} icon="list" bodyClassName="px-4">
              <ul>
                {rest.map((t) => (
                  <TaskItem key={t.id} task={t} now={now} back={back} role={active.role} members={members} channels={channels} />
                ))}
              </ul>
            </Card>
          )}

          {canWrite && !askNext && (
            <details id="nueva-tarea" className="rounded border border-line bg-surface p-4" open={!next && open}>
              <summary className="cursor-pointer text-sm font-semibold text-brand-text">
                <Icon name="plus" className="mr-1 inline size-4 align-[-3px]" />
                Nueva tarea
              </summary>
              <div className="mt-3">
                <NewTaskForm contactId={o.contactId} opportunityId={o.id} members={members} userId={user.id} back={back} now={now} />
              </div>
            </details>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {canWrite && (
            <Card title="Cambiar etapa" icon="kanban">
              <MoveForm opportunityId={o.id} currentStageId={o.stageId} currentKind={data.stageKind} stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))} back={back} />
            </Card>
          )}

          <Card title="Datos del viaje" icon="note">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className={`break-words ${v === UNKNOWN ? "italic text-slate-500" : "text-slate-900"}`}>{v}</dd>
                </div>
              ))}
            </dl>
            {o.notes && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{o.notes}</p>}
          </Card>

          {canWrite && (
            <Card title="WhatsApp" icon="message">
              {contact.phones.length === 0 ? (
                <Notice>El contacto no tiene teléfono. Agrégalo en la ficha del contacto.</Notice>
              ) : contact.phones.every((p) => p.unverified) ? (
                <Notice>El teléfono llegó por el formulario web y está sin verificar. Confírmalo en la ficha del contacto para escribirle.</Notice>
              ) : !whatsappAllowed(contact.consents) ? (
                <Notice tone="error">El contacto retiró el permiso de WhatsApp para atención del viaje.</Notice>
              ) : (
                <WhatsappButton contactId={o.contactId} opportunityId={o.id} draft={draft} />
              )}
              <p className="mt-2 text-xs text-slate-500">El historial completo está en la ficha del contacto.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
