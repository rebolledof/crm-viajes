import Link from "next/link";
import { Notice, buttonClass, inputClass, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { formatPhone } from "@/domain/phone";
import { listContacts } from "@/server/contacts";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { Flash, memberName, type SearchParams } from "../crm-ui";

export default async function ContactosPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = await searchParams;
  const q = sp.q?.slice(0, 100) ?? "";
  const [rows, members] = await withUser(getDb(), user, (tx) =>
    Promise.all([listContacts(tx, user.id, active.agencyId, q), activeMembers(tx, user.id, active.agencyId)]),
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Contactos</h1>
        {can(active.role, "crm.write") && (
          <Link href="/app/contactos/nuevo" className={buttonClass}>Nuevo contacto</Link>
        )}
      </div>
      <Flash sp={sp} />
      <form className="flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Buscar</label>
        <input id="q" name="q" defaultValue={q} placeholder="Nombre, teléfono o correo" className={`${inputClass} min-w-64 flex-1`} />
        <button className={buttonClass}>Buscar</button>
        {q && <Link href="/app/contactos" className={`${linkButtonClass} self-center`}>Limpiar</Link>}
      </form>
      {rows.length === 0 ? (
        <Notice>{q ? "No hay contactos que coincidan con la búsqueda." : "Todavía no hay contactos. Crea el primero."}</Notice>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Teléfono</th>
                <th className="px-3 py-2">Correo</th>
                <th className="px-3 py-2">Responsable</th>
                <th className="px-3 py-2">Abiertas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link href={`/app/contactos/${c.id}`} className="font-medium text-sky-700 hover:underline">{c.fullName}</Link>
                    {c.tags.length > 0 && <span className="ml-2 text-xs text-slate-500">{c.tags.join(", ")}</span>}
                  </td>
                  <td className="px-3 py-2">{c.phone ? formatPhone(c.phone) : ""}</td>
                  <td className="px-3 py-2">{c.email ?? ""}</td>
                  <td className="px-3 py-2">{memberName(members, c.ownerId)}</td>
                  <td className="px-3 py-2">{c.openOpportunities}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
