import Link from "next/link";
import { Field, Notice, buttonClass, inputClass, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { STAGE_KIND_LABELS } from "@/domain/pipeline";
import { formatPhone } from "@/domain/phone";
import { whatsappAllowed } from "@/domain/whatsapp";
import { getContactDetail, whatsappDraft } from "@/server/contacts";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { recordConsentAction } from "../../crm-actions";
import { Flash, NewTaskForm, TaskItem, describeActivity, fechaHora, loadOr404, memberName, type SearchParams } from "../../crm-ui";
import { WhatsappButton } from "../whatsapp-button";

const CHANNEL_LABELS = { whatsapp: "WhatsApp", correo: "Correo", telefono: "Teléfono" } as const;
const PURPOSE_LABELS = { servicio: "Atención del viaje", promociones: "Promociones" } as const;

export default async function ContactoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const { id } = await params;
  const sp = await searchParams;
  const [detail, members, draft] = await loadOr404(id, () =>
    withUser(getDb(), user, (tx) =>
      Promise.all([getContactDetail(tx, user.id, active.agencyId, id), activeMembers(tx, user.id, active.agencyId), whatsappDraft(tx, active.agencyId, id)]),
    ),
  );
  const c = detail.contact;
  const canWrite = can(active.role, "crm.write");
  const now = new Date();
  const back = `/app/contactos/${c.id}`;
  const preferredPhone = detail.phones[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm"><Link href="/app/contactos" className={linkButtonClass}>Contactos</Link></p>
          <h1 className="text-2xl font-semibold text-slate-900">{c.fullName}</h1>
          <p className="text-sm text-slate-600">
            Responsable: {memberName(members, c.ownerId)}
            {c.city && ` · ${c.city}`}
            {c.source && ` · Origen: ${c.source}`}
          </p>
        </div>
        {canWrite && <Link href={`${back}/editar`} className={linkButtonClass}>Editar contacto</Link>}
      </div>
      <Flash sp={sp} />

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div className="text-sm">
          <h2 className="mb-2 font-medium text-slate-900">Datos</h2>
          <ul className="flex flex-col gap-1 text-slate-700">
            {detail.phones.map((p) => (
              <li key={p.id}>{formatPhone(p.e164)}{p.isPreferred && " (preferido)"}</li>
            ))}
            {detail.emails.map((e) => (
              <li key={e.id}>{e.email}{e.isPreferred && " (preferido)"}</li>
            ))}
            {c.tags.length > 0 && <li>Etiquetas: {c.tags.join(", ")}</li>}
            {c.notes && <li className="whitespace-pre-line">{c.notes}</li>}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-medium text-slate-900">WhatsApp</h2>
          {!preferredPhone ? (
            <Notice>Agrega un teléfono para poder escribirle.</Notice>
          ) : !whatsappAllowed(detail.consents) ? (
            <Notice tone="error">El contacto retiró el permiso de WhatsApp para atención del viaje.</Notice>
          ) : canWrite ? (
            <WhatsappButton contactId={c.id} draft={draft} />
          ) : (
            <p className="text-sm text-slate-600">{formatPhone(preferredPhone.e164)}</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">Oportunidades</h2>
          {canWrite && <Link href={`/app/oportunidades/nueva?contactId=${c.id}`} className={linkButtonClass}>Nueva oportunidad</Link>}
        </div>
        {detail.opportunities.length === 0 ? (
          <Notice>Este contacto no tiene oportunidades.</Notice>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.opportunities.map((o) => (
              <li key={o.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                <Link href={`/app/oportunidades/${o.id}`} className="font-medium text-sky-700 hover:underline">{o.destination || "Sin destino"}</Link>
                <span className="text-slate-600"> · {o.stageName} ({STAGE_KIND_LABELS[o.stageKind]}) · {memberName(members, o.ownerId)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Tareas abiertas</h2>
        {detail.openTasks.length === 0 ? (
          <Notice>No hay tareas abiertas.</Notice>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.openTasks.map((t) => (
              <TaskItem key={t.id} task={t} now={now} back={back} canWrite={canWrite} members={members} />
            ))}
          </ul>
        )}
        {canWrite && (
          <details className="rounded-lg border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-sky-700">Nueva tarea</summary>
            <div className="mt-3">
              <NewTaskForm contactId={c.id} members={members} userId={user.id} back={back} now={now} />
            </div>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Consentimientos</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
          <form action={recordConsentAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <input type="hidden" name="contactId" value={c.id} />
            <Field label="Canal">
              <select name="channel" className={inputClass}>
                {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Finalidad">
              <select name="purpose" className={inputClass}>
                {Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Estado">
              <select name="status" className={inputClass}>
                <option value="otorgado">Otorgado</option>
                <option value="retirado">Retirado</option>
              </select>
            </Field>
            <Field label="Cómo lo dijo">
              <input name="source" required placeholder="Por WhatsApp el 19 de octubre" className={inputClass} />
            </Field>
            <button className={buttonClass}>Registrar</button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Historial</h2>
        {detail.history.length === 0 ? (
          <Notice>Sin actividad todavía.</Notice>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {detail.history.map((h) => (
              <li key={h.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <span className="text-slate-500">{fechaHora.format(h.createdAt)} · {memberName(members, h.actorId)}</span>
                <p className="text-slate-800">{describeActivity(h.kind, h.data, members)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
