import Link from "next/link";
import { Notice, buttonClass, inputClass, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { TASK_KINDS, TASK_KIND_LABELS, dueState, isTaskKind } from "@/domain/tasks";
import { requireActiveAgency } from "@/server/session";
import { TASK_STATUSES, activeMembers, listTasks, type TaskStatus } from "@/server/tasks";
import { Flash, TaskItem, fechaHora, memberName, type SearchParams } from "../crm-ui";

const STATUS_LABELS: Record<TaskStatus, string> = { abierta: "Abiertas", completada: "Completadas", cancelada: "Canceladas" };
const GROUPS = [
  { key: "vencida", title: "Vencidas", tone: "text-red-700" },
  { key: "hoy", title: "Hoy", tone: "text-amber-700" },
  { key: "proxima", title: "Próximas", tone: "text-slate-800" },
] as const;

/** Módulo de Tareas (RF-218): todas las tareas de la agencia con filtros. */
export default async function TareasPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = await searchParams;
  const members = await withUser(getDb(), user, (tx) => activeMembers(tx, user.id, active.agencyId));
  const owner = sp.responsable ?? "mias";
  const status: TaskStatus = (TASK_STATUSES as readonly string[]).includes(sp.estado ?? "") ? (sp.estado as TaskStatus) : "abierta";
  const kind = isTaskKind(sp.tipo) ? sp.tipo : undefined;
  const assigneeId = owner === "todas" ? undefined : (members.find((m) => m.userId === owner)?.userId ?? user.id);
  const rows = await withUser(getDb(), user, (tx) => listTasks(tx, user.id, active.agencyId, { assigneeId, status, kind }));
  const now = new Date();
  const query = new URLSearchParams({ responsable: owner, estado: status, ...(kind ? { tipo: kind } : {}) });
  const back = `/app/tareas?${query}`;

  const link = (r: (typeof rows)[number]) => (
    <p className="text-sm">
      <Link href={r.task.opportunityId ? `/app/oportunidades/${r.task.opportunityId}` : `/app/contactos/${r.task.contactId}`} className="text-sky-700 hover:underline">
        {r.contactName}
        {r.task.opportunityId ? ` · ${r.destination || "Sin destino"}` : " · sin oportunidad"}
      </Link>
    </p>
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Tareas</h1>
      <Flash sp={sp} />
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-700">Responsable</span>
          <select name="responsable" defaultValue={owner} className={inputClass}>
            <option value="mias">Mías</option>
            <option value="todas">Todo el equipo</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.email}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-700">Estado</span>
          <select name="estado" defaultValue={status} className={inputClass}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-700">Tipo</span>
          <select name="tipo" defaultValue={kind ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>{TASK_KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <button className={buttonClass}>Ver</button>
        <Link href="/app/tareas" className={`${linkButtonClass} self-center`}>Limpiar filtros</Link>
      </form>

      {rows.length === 0 && (
        <Notice>
          No hay tareas con estos filtros. Las tareas se crean desde la ficha de un contacto o desde una oportunidad.
        </Notice>
      )}
      {rows.length === 300 && <Notice>Se muestran las primeras 300. Usa los filtros para acotar.</Notice>}

      {status === "abierta"
        ? GROUPS.map((g) => {
            const list = rows.filter((r) => dueState(r.task.dueAt, now) === g.key);
            if (list.length === 0) return null;
            return (
              <section key={g.key} className="flex flex-col gap-3">
                <h2 className={`font-medium ${g.tone}`}>{g.title} ({list.length})</h2>
                <ul className="flex flex-col gap-2">
                  {list.map((r) => (
                    <TaskItem key={r.task.id} task={r.task} now={now} back={back} role={active.role} members={members} extra={link(r)} />
                  ))}
                </ul>
              </section>
            );
          })
        : rows.length > 0 && (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.task.id} className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium text-slate-900">{r.task.title}</span>
                    <span className="text-slate-600">
                      {TASK_KIND_LABELS[r.task.kind]} · {memberName(members, r.task.assigneeId)}
                      {r.task.completedAt && ` · completada ${fechaHora.format(r.task.completedAt)}`}
                    </span>
                  </div>
                  {link(r)}
                  {r.task.result && (
                    <p className="text-slate-700">{status === "completada" ? "Resultado" : "Motivo"}: {r.task.result}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}
