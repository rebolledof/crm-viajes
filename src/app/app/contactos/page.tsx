import { firstParams } from "@/domain/params";
import Link from "next/link";
import { Chip, Notice, PageHeader, buttonClass, inputClass, linkButtonClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import { nextStepStatus } from "@/domain/guide";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { formatPhone } from "@/domain/phone";
import { listContacts } from "@/server/contacts";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { DueChip, Flash, memberName, type SearchParams } from "../crm-ui";

export default async function ContactosPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = firstParams(await searchParams);
  const q = sp.q?.slice(0, 100) ?? "";
  const [rows, members] = await withUser(getDb(), user, (tx) =>
    Promise.all([listContacts(tx, user.id, active.agencyId, q), activeMembers(tx, user.id, active.agencyId)]),
  );
  const now = new Date();
  const canWrite = can(active.role, "crm.write");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="users" title="Contactos" actions={canWrite && <Link href="/app/contactos/nuevo" className={buttonClass}><Icon name="plus" className="size-4" />Nuevo contacto</Link>}>
        <p className="text-sm text-slate-600">Cada contacto muestra su siguiente paso. Los que dicen «Sin siguiente paso» necesitan una tarea.</p>
      </PageHeader>
      <Flash sp={sp} />
      <form className="flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Buscar</label>
        <input id="q" name="q" type="search" defaultValue={q} maxLength={100} placeholder="Nombre, teléfono o correo" className={`${inputClass} min-w-0 flex-1 basis-56`} />
        <button className={buttonClass}>Buscar</button>
        {q && <Link href="/app/contactos" className={`${linkButtonClass} self-center`}>Limpiar</Link>}
      </form>
      {rows.length === 0 ? (
        <Notice>{q ? `No hay contactos que coincidan con «${q}». Revisa la escritura o busca por teléfono o correo.` : canWrite ? "Todavía no hay contactos. Crea el primero con «Nuevo contacto»." : "Todavía no hay contactos."}</Notice>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/app/contactos/${c.id}`} className="flex flex-col gap-1 rounded border border-line bg-surface p-3 text-sm hover:border-brand">
                  <span className="font-semibold text-slate-900">{c.fullName}</span>
                  <span className="text-xs text-slate-600">{[c.phone ? formatPhone(c.phone) : "", c.email ?? ""].filter(Boolean).join(" · ")}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {c.stageName && <Chip tone="brand">{c.stageName}</Chip>}
                    <NextStep next={c.nextTask} open={c.openOpportunities} now={now} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded border border-line bg-surface md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Etapa</th>
                  <th className="px-3 py-2">Siguiente paso</th>
                  <th className="px-3 py-2">Teléfono</th>
                  <th className="px-3 py-2">Responsable</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <Link href={`/app/contactos/${c.id}`} className="font-medium text-brand-text hover:underline">{c.fullName}</Link>
                      {c.email && <div className="text-xs text-slate-500">{c.email}</div>}
                      {c.tags.length > 0 && <div className="text-xs text-slate-500">{c.tags.join(", ")}</div>}
                    </td>
                    <td className="px-3 py-2">{c.stageName ? <Chip tone="brand">{c.stageName}</Chip> : <span className="text-slate-500">{c.openOpportunities ? "" : "Sin oportunidad"}</span>}</td>
                    <td className="px-3 py-2">
                      {c.nextTask && <div className="mb-1 text-slate-800">{c.nextTask.title}</div>}
                      <NextStep next={c.nextTask} open={c.openOpportunities} now={now} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{c.phone ? formatPhone(c.phone) : ""}</td>
                    <td className="px-3 py-2">{memberName(members, c.ownerId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Estado del siguiente paso del contacto (alcance 5 de SPEC-002c). */
function NextStep({ next, open, now }: { next: { title: string; due_at: string } | null; open: number; now: Date }) {
  const dueAt = next ? new Date(next.due_at) : null;
  const status = nextStepStatus({ dueAt, openOpportunities: open }, now);
  if (dueAt) return <DueChip dueAt={dueAt} now={now} />;
  if (status === "sin_paso") return <Chip tone="red" icon="alert">Sin siguiente paso</Chip>;
  return <span className="text-xs text-slate-500">Nada pendiente</span>;
}
