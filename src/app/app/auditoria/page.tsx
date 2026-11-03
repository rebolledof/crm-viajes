import { redirect } from "next/navigation";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { listAudit, listMembers } from "@/server/agencies";
import { requireActiveAgency } from "@/server/session";

const fecha = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });

const ACTIONS: Record<string, string> = {
  "agency.created": "Creó la agencia",
  "agency.renamed": "Cambió el nombre de la agencia",
  "invitation.created": "Creó una invitación",
  "invitation.revoked": "Revocó una invitación",
  "invitation.accepted": "Aceptó una invitación",
  "membership.role_changed": "Cambió el rol de un miembro",
  "membership.revoked": "Quitó el acceso a un miembro",
};

export default async function AuditoriaPage() {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "audit.read")) redirect("/app");
  const [events, members] = await withUser(getDb(), user, (tx) =>
    Promise.all([listAudit(tx, user.id, active.agencyId, 100), listMembers(tx, active.agencyId)]),
  );
  const who = new Map(members.map((m) => [m.userId, m.email]));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Auditoría</h1>
      <p className="text-sm text-slate-600">Últimas 100 acciones registradas en la agencia.</p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Persona</th><th className="px-3 py-2">Acción</th><th className="px-3 py-2">Detalle</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-3 py-2">{fecha.format(e.createdAt)}</td>
                <td className="px-3 py-2">{(e.actorId && who.get(e.actorId)) ?? "—"}</td>
                <td className="px-3 py-2">{ACTIONS[e.action] ?? e.action}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{Object.keys(e.changes).length ? JSON.stringify(e.changes) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
