import { firstParams } from "@/domain/params";
import Link from "next/link";
import { ActionForm, Input, Select } from "@/components/form";
import { Card, Chip, Field, Notice, PageHeader, buttonClass, linkButtonClass, secondaryButtonClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import { stagePath } from "@/domain/guide";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { STAGE_KIND_LABELS } from "@/domain/pipeline";
import { formatPhone } from "@/domain/phone";
import { whatsappAllowed } from "@/domain/whatsapp";
import { getContactDetail, whatsappDraft } from "@/server/contacts";
import { requireActiveAgency } from "@/server/session";
import { activeMembers, contactChannels } from "@/server/tasks";
import { recordConsentAction, verifyContactPointAction } from "../../crm-actions";
import { Flash, NewTaskForm, TaskItem, describeActivity, fechaHora, loadOr404, memberName, type SearchParams } from "../../crm-ui";
import { WhatsappButton } from "../whatsapp-button";
import { StagePath } from "../../stage-path";
import { listStages } from "@/server/opportunities";

const CHANNEL_LABELS = { whatsapp: "WhatsApp", correo: "Correo", telefono: "Teléfono" } as const;
const PURPOSE_LABELS = { servicio: "Atención del viaje", promociones: "Promociones" } as const;

export default async function ContactoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const { id } = await params;
  const sp = firstParams(await searchParams);
  const [detail, members, draft, channels, stages] = await loadOr404(id, () =>
    withUser(getDb(), user, (tx) =>
      Promise.all([
        getContactDetail(tx, user.id, active.agencyId, id),
        activeMembers(tx, user.id, active.agencyId),
        whatsappDraft(tx, active.agencyId, id),
        contactChannels(tx, user.id, active.agencyId, [id]),
        listStages(tx, user.id, active.agencyId),
      ]),
    ),
  );
  const c = detail.contact;
  const canWrite = can(active.role, "crm.write");
  const now = new Date();
  const back = `/app/contactos/${c.id}`;
  const preferredPhone = detail.phones[0];
  const openOpps = detail.opportunities.filter((o) => o.stageKind === "abierta").map((o) => ({ id: o.id, label: `${o.destination || "Sin destino"} · ${o.stageName}` }));
  const oppLabel = new Map(detail.opportunities.map((o) => [o.id, o.destination || "Sin destino"]));
  // El viaje en curso es la oportunidad abierta que se movió más recientemente.
  const current = detail.opportunities.find((o) => o.stageKind === "abierta");
  const path = current ? stagePath(stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })), { stageId: current.stageId, kind: current.stageKind }) : null;
  const goal = current ? stages.find((s) => s.id === current.stageId)?.goal : null;

  const taskList = (
    <Card
      title={`Tareas abiertas (${detail.openTasks.length})`}
      icon="check"
      bodyClassName="px-4"
    >
      {detail.openTasks.length === 0 ? (
        <div className="py-4">
          <Notice>{current ? "No hay tareas abiertas. Crea la siguiente para no perder el seguimiento." : "No hay tareas abiertas. Crea una para recordar el próximo contacto."}</Notice>
        </div>
      ) : (
        <ul>
          {detail.openTasks.map((t, i) => (
            <TaskItem
              key={t.id}
              task={t}
              now={now}
              back={back}
              role={active.role}
              members={members}
              channels={channels}
              primary={i === 0}
              extra={
                t.opportunityId ? (
                  <Link href={`/app/oportunidades/${t.opportunityId}`} className="text-brand-text hover:underline">Oportunidad: {oppLabel.get(t.opportunityId)}</Link>
                ) : (
                  "Sin oportunidad"
                )
              }
            />
          ))}
        </ul>
      )}
      {canWrite && (
        <details id="nueva-tarea" className="border-t border-slate-100 py-3" open={detail.openTasks.length === 0 && !!current}>
          <summary className="cursor-pointer text-sm font-semibold text-brand-text">
            <Icon name="plus" className="mr-1 inline size-4 align-[-3px]" />
            Nueva tarea
          </summary>
          <div className="mt-3">
            <NewTaskForm contactId={c.id} opportunities={openOpps} members={members} userId={user.id} back={back} now={now} />
          </div>
        </details>
      )}
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="users"
        eyebrow={<Link href="/app/contactos" className={linkButtonClass}>Contactos</Link>}
        title={c.fullName}
        actions={canWrite && <Link href={`${back}/editar`} className={secondaryButtonClass}>Editar contacto</Link>}
      >
        <p className="text-sm text-slate-600">
          Responsable: {memberName(members, c.ownerId)}
          {c.city && ` · ${c.city}`}
          {c.source && ` · Origen: ${c.source}`}
        </p>
      </PageHeader>
      <Flash sp={sp} />

      {current && path && (
        <Card
          title={<>Viaje en curso: <Link href={`/app/oportunidades/${current.id}`} className="text-brand-text hover:underline">{current.destination || "Destino sin definir"}</Link></>}
          icon="plane"
          bodyClassName="p-4 flex flex-col gap-3"
        >
          <StagePath items={path} compact />
          <p className="text-sm text-slate-700">
            Etapa actual: <strong>{current.stageName}</strong>
            {goal && <> · Meta: {goal}</>}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {taskList}

          <Card
            title={`Oportunidades (${detail.opportunities.length})`}
            icon="kanban"
            actions={canWrite && <Link href={`/app/oportunidades/nueva?contactId=${c.id}`} className={linkButtonClass}>Nueva oportunidad</Link>}
          >
            {detail.opportunities.length === 0 ? (
              <Notice>Este contacto no tiene oportunidades. Crea una cuando pida un viaje o una cotización.</Notice>
            ) : (
              <ul className="flex flex-col">
                {detail.opportunities.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2 text-sm last:border-b-0">
                    <Link href={`/app/oportunidades/${o.id}`} className="font-medium text-brand-text hover:underline">{o.destination || "Sin destino"}</Link>
                    <Chip tone={o.stageKind === "ganada" ? "green" : o.stageKind === "perdida" ? "red" : "brand"}>{o.stageName}</Chip>
                    <span className="text-slate-600">{STAGE_KIND_LABELS[o.stageKind]} · {memberName(members, o.ownerId)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Historial" icon="clock">
            {detail.history.length === 0 ? (
              <Notice>Sin actividad todavía. Aquí aparecerá cada tarea, cambio de etapa y mensaje.</Notice>
            ) : (
              <ol className="flex flex-col text-sm">
                {detail.history.map((h) => (
                  <li key={h.id} className="border-l-2 border-brand-line py-1.5 pl-3">
                    <span className="text-xs text-slate-500">{fechaHora.format(h.createdAt)} · {memberName(members, h.actorId)}</span>
                    <p className="text-slate-800">{describeActivity(h.kind, h.data, members)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Datos" icon="note">
            <ul className="flex flex-col gap-1 text-sm text-slate-700">
              {detail.phones.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <Icon name="phone" className="size-3.5 text-slate-500" />
                  {formatPhone(p.e164)}
                  {p.isPreferred && !p.unverified && " (preferido)"}
                  {p.unverified && <Unverified contactId={c.id} kind="telefono" pointId={p.id} canWrite={canWrite} />}
                </li>
              ))}
              {detail.emails.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 break-all">
                  <Icon name="mail" className="size-3.5 text-slate-500" />
                  {e.email}
                  {e.isPreferred && !e.unverified && " (preferido)"}
                  {e.unverified && <Unverified contactId={c.id} kind="correo" pointId={e.id} canWrite={canWrite} />}
                </li>
              ))}
              {c.tags.length > 0 && <li className="flex flex-wrap gap-1 pt-1">{c.tags.map((t) => <Chip key={t}>{t}</Chip>)}</li>}
              {c.notes && <li className="whitespace-pre-line pt-1">{c.notes}</li>}
            </ul>
          </Card>

          <Card title="WhatsApp" icon="message">
            {!preferredPhone ? (
              <Notice>Agrega un teléfono para poder escribirle.</Notice>
            ) : preferredPhone.unverified ? (
              <Notice>El teléfono llegó por el formulario web y está sin verificar. Confírmalo arriba, en Datos, para escribirle.</Notice>
            ) : !whatsappAllowed(detail.consents) ? (
              <Notice tone="error">El contacto retiró el permiso de WhatsApp para atención del viaje.</Notice>
            ) : canWrite ? (
              <WhatsappButton contactId={c.id} draft={draft} />
            ) : (
              <p className="text-sm text-slate-600">{formatPhone(preferredPhone.e164)}</p>
            )}
          </Card>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Icon name="shield" className="size-4 text-slate-500" />Consentimientos</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr><th className="px-3 py-2">Canal</th><th className="px-3 py-2">Finalidad</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Fuente</th><th className="px-3 py-2">Fecha</th></tr>
            </thead>
            <tbody>
              {detail.consents.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-2 text-slate-600">Sin registros. Se asume permiso para atender el viaje que el contacto pidió.</td></tr>
              )}
              {detail.consents.map((k) => (
                <tr key={`${k.channel}-${k.purpose}`} className="border-t border-slate-100">
                  <td className="px-3 py-2">{CHANNEL_LABELS[k.channel]}</td>
                  <td className="px-3 py-2">{PURPOSE_LABELS[k.purpose]}</td>
                  <td className="px-3 py-2">{k.status === "otorgado" ? "Otorgado" : "Retirado"}</td>
                  <td className="px-3 py-2">{k.source}</td>
                  <td className="px-3 py-2">{fechaHora.format(k.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canWrite && (
          <ActionForm action={recordConsentAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-surface p-4">
            <input type="hidden" name="contactId" value={c.id} />
            <Field label="Canal">
              <Select name="channel">
                {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Finalidad">
              <Select name="purpose">
                {Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Estado">
              <Select name="status">
                <option value="otorgado">Otorgado</option>
                <option value="retirado">Retirado</option>
              </Select>
            </Field>
            <Field label="Cómo lo dijo">
              <Input name="source" required placeholder="Por WhatsApp el 19 de octubre" />
            </Field>
            <button className={buttonClass}>Registrar</button>
          </ActionForm>
        )}
      </section>

    </div>
  );
}

/**
 * Dato sin verificar (D-14): llegó por el formulario web a un contacto que ya existía, así que
 * pudo escribirlo otra persona. No se usa para escribirle hasta que un asesor lo confirma.
 */
function Unverified({ contactId, kind, pointId, canWrite }: { contactId: string; kind: "telefono" | "correo"; pointId: string; canWrite: boolean }) {
  return (
    <>
      <Chip tone="amber" icon="alert">Sin verificar</Chip>
      {canWrite && (
        <details className="w-full">
          <summary className="cursor-pointer text-sm font-medium text-brand-text">Confirmar este {kind === "telefono" ? "teléfono" : "correo"}</summary>
          <form action={verifyContactPointAction} className="mt-1 flex flex-col gap-2 rounded border border-line bg-surface p-3">
            <input type="hidden" name="contactId" value={contactId} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="pointId" value={pointId} />
            <p className="text-sm text-slate-700">Llegó por el formulario web y pudo escribirlo otra persona. Confírmalo solo si el cliente te dijo que es suyo.</p>
            <button className={`${buttonClass} self-start`}>Sí, es del cliente</button>
          </form>
        </details>
      )}
    </>
  );
}

