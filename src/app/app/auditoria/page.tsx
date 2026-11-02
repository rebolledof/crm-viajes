import { PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { listMembers } from "@/server/agencies";
import { listAuditReadable } from "@/server/audit";
import { requireActiveAgency } from "@/server/session";

const fecha = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });

export default async function AuditoriaPage() {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "audit.read")) redirect("/app");
  const [events, members] = await withUser(getDb(), user, (tx) =>
    Promise.all([listAuditReadable(tx, user.id, active.agencyId, 100), listMembers(tx, active.agencyId)]),
  );
  const who = new Map(members.map((m) => [m.userId, m.email]));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="shield" title="Auditoría">
        <p className="text-sm text-slate-600">Últimas 100 acciones registradas en la agencia, de la más reciente a la más antigua. Hora de Colombia.</p>
      </PageHeader>
      {events.length === 0 ? (
        <p className="text-sm text-slate-600">Todavía no hay acciones registradas. Aquí aparecerá cada cambio que haga el equipo.</p>
      ) : (
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Persona</th><th className="px-3 py-2">Qué hizo</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-3 py-2">{fecha.format(e.createdAt)}</td>
                <td className="px-3 py-2">{(e.actorId && who.get(e.actorId)) ?? "Sistema"}</td>
                <td className="px-3 py-2">
                  <p className="text-slate-900">{e.description.text}</p>
                  {e.description.details.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-600">
                      {e.description.details.map((d, i) => (
                        <li key={i} className="break-words">{d}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
