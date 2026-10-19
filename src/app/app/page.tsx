import Link from "next/link";
import { Field, Notice, buttonClass, inputClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { ROLE_LABELS, can } from "@/domain/permissions";
import { requireActiveAgency } from "@/server/session";
import { activeMembers, myDay } from "@/server/tasks";
import { renameAgencyAction } from "./actions";
import { Flash, TaskItem, fechaHora, type SearchParams } from "./crm-ui";

/** Mi día: tareas vencidas y de hoy, y oportunidades sin próxima acción (RF-210). */
export default async function AppHome({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = await searchParams;
  const now = new Date();
  const [day, members] = await withUser(getDb(), user, (tx) => Promise.all([myDay(tx, user.id, active.agencyId, now), activeMembers(tx, user.id, active.agencyId)]));
  const canWrite = can(active.role, "crm.write");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Mi día</h1>
        <p className="text-sm text-slate-600">{active.agencyName} · {ROLE_LABELS[active.role]}</p>
      </div>
      <Flash sp={sp} />
      {sp.ok === "agencia" && <Notice tone="ok">Nombre de la agencia actualizado.</Notice>}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Tareas para hoy y vencidas ({day.due.length})</h2>
        {day.due.length === 0 ? (
          <Notice>No tienes tareas pendientes para hoy.</Notice>
        ) : (
          <ul className="flex flex-col gap-2">
            {day.due.map(({ task, contactName, destination }) => (
              <TaskItem
                key={task.id}
                task={task}
                now={now}
                back="/app"
                canWrite={canWrite}
                members={members}
                extra={
                  <p className="text-sm">
                    <Link href={task.opportunityId ? `/app/oportunidades/${task.opportunityId}` : `/app/contactos/${task.contactId}`} className="text-sky-700 hover:underline">
                      {contactName}{destination ? ` · ${destination}` : ""}
                    </Link>
                  </p>
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Sin próxima acción ({day.withoutNextAction.length})</h2>
        {day.withoutNextAction.length === 0 ? (
          <Notice>Todas tus oportunidades abiertas tienen una próxima acción.</Notice>
        ) : (
          <ul className="flex flex-col gap-2">
            {day.withoutNextAction.map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline gap-x-3 rounded-md border border-red-200 bg-white p-3 text-sm">
                <span className="text-xs font-semibold uppercase text-red-700">Sin próxima acción</span>
                <Link href={`/app/oportunidades/${o.id}`} className="font-medium text-sky-700 hover:underline">
                  {o.contactName} · {o.destination || "Destino desconocido"}
                </Link>
                <span className="text-slate-600">{o.stageName} · actualizada {fechaHora.format(o.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can(active.role, "agency.update") && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-900">Datos de la agencia</h2>
          <form action={renameAgencyAction} className="flex flex-wrap items-end gap-3">
            <Field label="Nombre">
              <input id="name" name="name" defaultValue={active.agencyName} required minLength={2} maxLength={120} className={inputClass} />
            </Field>
            <button className={buttonClass}>Guardar</button>
          </form>
        </section>
      )}
    </div>
  );
}
