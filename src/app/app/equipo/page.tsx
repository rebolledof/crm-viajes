import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { invitationStatus } from "@/domain/invitations";
import { ROLES, ROLE_LABELS, can } from "@/domain/permissions";
import { listInvitations, listMembers } from "@/server/agencies";
import { ERROR_MESSAGES, isErrorCode } from "@/server/errors";
import { requireActiveAgency } from "@/server/session";
import { changeRoleAction, revokeInvitationAction, revokeMemberAction } from "../actions";
import { InviteForm } from "./invite-form";

const fecha = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" });
const STATUS_LABEL = { pendiente: "Pendiente", aceptada: "Aceptada", revocada: "Revocada", vencida: "Vencida" };

export default async function EquipoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "team.manage")) redirect("/app");
  const sp = await searchParams;
  const [members, invites] = await withUser(getDb(), user, (tx) =>
    Promise.all([listMembers(tx, active.agencyId), listInvitations(tx, active.agencyId)]),
  );
  const now = new Date();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold text-slate-900">Equipo</h1>
      {isErrorCode(sp.error) && <Notice tone="error">{ERROR_MESSAGES[sp.error]}</Notice>}

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium text-slate-900">Invitar a una persona</h2>
        <InviteForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Miembros</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr><th className="px-3 py-2">Correo</th><th className="px-3 py-2">Rol</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Acciones</th></tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.userId === user.id;
                return (
                  <tr key={m.userId} className="border-t border-slate-100">
                    <td className="px-3 py-2">{m.email}{self && " (tú)"}</td>
                    <td className="px-3 py-2">
                      {self || m.revokedAt ? ROLE_LABELS[m.role] : (
                        <form action={changeRoleAction} className="flex items-center gap-2">
                          <input type="hidden" name="memberId" value={m.userId} />
                          <label htmlFor={`role-${m.userId}`} className="sr-only">Rol de {m.email}</label>
                          <select id={`role-${m.userId}`} name="role" defaultValue={m.role} className="rounded border border-slate-300 px-2 py-1">
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                          <button className="text-sky-700 hover:underline">Guardar</button>
                        </form>
                      )}
                    </td>
                    <td className="px-3 py-2">{m.revokedAt ? "Sin acceso" : "Activo"}</td>
                    <td className="px-3 py-2">
                      {!self && !m.revokedAt && (
                        <form action={revokeMemberAction}>
                          <input type="hidden" name="memberId" value={m.userId} />
                          <button className="text-red-700 hover:underline">Quitar acceso</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Invitaciones</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-slate-600">Todavía no has invitado a nadie.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr><th className="px-3 py-2">Correo</th><th className="px-3 py-2">Rol</th><th className="px-3 py-2">Vence</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Acciones</th></tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const status = invitationStatus(i, now);
                  return (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{i.email}</td>
                      <td className="px-3 py-2">{ROLE_LABELS[i.role]}</td>
                      <td className="px-3 py-2">{fecha.format(i.expiresAt)}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[status]}</td>
                      <td className="px-3 py-2">
                        {status === "pendiente" && (
                          <form action={revokeInvitationAction}>
                            <input type="hidden" name="invitationId" value={i.id} />
                            <button className="text-red-700 hover:underline">Revocar</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
