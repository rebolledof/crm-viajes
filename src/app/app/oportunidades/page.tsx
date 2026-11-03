import { firstParams } from "@/domain/params";
import Link from "next/link";
import { Notice, inputClass, buttonClass, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { STAGE_KIND_LABELS } from "@/domain/pipeline";
import { listOpportunities, listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { Flash, budget, fechaHora, formatDay, memberName, type Member, type SearchParams } from "../crm-ui";

export default async function OportunidadesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = firstParams(await searchParams);
  const owner = sp.responsable ?? "mias";
  const view = sp.vista === "lista" ? "lista" : "tablero";
  const q = sp.q?.trim().slice(0, 100) ?? "";
  const [stages, members] = await withUser(getDb(), user, (tx) => Promise.all([listStages(tx, user.id, active.agencyId), activeMembers(tx, user.id, active.agencyId)]));
  const ownerId = owner === "todas" ? undefined : (members.find((m) => m.userId === owner)?.userId ?? user.id);
  const opps = await withUser(getDb(), user, (tx) => listOpportunities(tx, user.id, active.agencyId, { ownerId, q }));
  const stageNames = new Map(stages.map((s) => [s.id, s.name]));
  const href = (v: string) => `/app/oportunidades?${new URLSearchParams({ vista: v, responsable: owner, ...(q ? { q } : {}) })}`;
  const byStage = new Map<string, typeof opps>();
  for (const o of opps) byStage.set(o.stageId, [...(byStage.get(o.stageId) ?? []), o]);
  const activeIds = new Set(stages.map((s) => s.id));
  const orphan = opps.filter((o) => !activeIds.has(o.stageId));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Oportunidades</h1>
        <nav aria-label="Vista" className="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {(["tablero", "lista"] as const).map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={view === v ? "page" : undefined}
              className={`rounded px-3 py-1.5 ${view === v ? "bg-sky-700 font-medium text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {v === "tablero" ? "Tablero" : "Lista"}
            </Link>
          ))}
        </nav>
      </div>
      <form role="search" className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="vista" value={view} />
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor="q" className="text-slate-700">Buscar</label>
          <input id="q" name="q" type="search" defaultValue={q} maxLength={100} placeholder="Cliente, destino, teléfono o correo" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="responsable" className="text-slate-700">Responsable</label>
          <select id="responsable" name="responsable" defaultValue={owner} className={inputClass}>
            <option value="mias">Mías</option>
            <option value="todas">Todas</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.email}</option>
            ))}
          </select>
        </div>
        <button className={buttonClass}>Buscar</button>
        {q && <Link href={`/app/oportunidades?${new URLSearchParams({ vista: view, responsable: owner })}`} className={`${linkButtonClass} self-center`}>Limpiar búsqueda</Link>}
      </form>
      <Flash sp={sp} />
      <p className="text-sm text-slate-600">
        Para crear una oportunidad abre la ficha del contacto. <Link href="/app/contactos" className="text-sky-700 underline">Ir a contactos</Link>
      </p>
      {opps.length === 0 && (
        <Notice>
          {q
            ? `No hay oportunidades que coincidan con «${q}». Revisa la escritura, prueba con el destino o el teléfono, o elige "Todas" en Responsable.`
            : owner === "todas"
              ? "Todavía no hay oportunidades. Ábrelas desde la ficha de un contacto."
              : 'No tienes oportunidades a tu nombre. Elige "Todas" en Responsable para ver las del equipo.'}
        </Notice>
      )}
      {view === "lista" ? (
        opps.length > 0 && <OpportunityList opps={opps} members={members} stageNames={stageNames} />
      ) : (
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex gap-3">
          {stages.map((s) => {
            const list = byStage.get(s.id) ?? [];
            return (
              <section key={s.id} aria-label={s.name} className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-slate-100 p-2">
                <h2 className="flex items-baseline justify-between px-1 text-sm font-medium text-slate-800">
                  <span>{s.name}</span>
                  <span className="text-xs text-slate-500">{s.kind !== "abierta" ? `${STAGE_KIND_LABELS[s.kind]} · ` : ""}{list.length}</span>
                </h2>
                {list.map((o) => (
                  <OpportunityCard key={o.id} o={o} members={members} />
                ))}
              </section>
            );
          })}
          {orphan.length > 0 && (
            <section aria-label="Etapas desactivadas" className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-slate-100 p-2">
              <h2 className="px-1 text-sm font-medium text-slate-800">En etapas desactivadas · {orphan.length}</h2>
              {orphan.map((o) => (
                <OpportunityCard key={o.id} o={o} members={members} />
              ))}
            </section>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

type Opp = Awaited<ReturnType<typeof listOpportunities>>[number];

function NextAction({ o }: { o: Opp }) {
  if (o.stageKind !== "abierta") return <span className="text-slate-500">{STAGE_KIND_LABELS[o.stageKind]}</span>;
  return o.nextActionAt ? (
    <span className="text-slate-700">{o.nextActionTitle} · {fechaHora.format(new Date(o.nextActionAt))}</span>
  ) : (
    <span className="font-semibold text-red-700">Sin próxima acción</span>
  );
}

function OpportunityList({ opps, members, stageNames }: { opps: Opp[]; members: Member[]; stageNames: Map<string, string> }) {
  return (
    <>
      <p className="text-sm text-slate-600" role="status">{opps.length === 1 ? "1 oportunidad" : `${opps.length} oportunidades`}</p>
      <ul className="flex flex-col gap-2 md:hidden">
        {opps.map((o) => (
          <li key={o.id}>
            <Link href={`/app/oportunidades/${o.id}`} className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-3 text-sm hover:border-sky-400">
              <span className="font-medium text-slate-900">{o.contactName}</span>
              <span className="text-slate-700">{o.destination || "Destino desconocido"} · {stageNames.get(o.stageId) ?? "Etapa desactivada"}</span>
              <span className="text-xs text-slate-500">{[formatDay(o.travelStart), budget(o.budgetAmount, o.budgetCurrency), memberName(members, o.ownerId)].filter(Boolean).join(" · ")}</span>
              <span className="text-xs"><NextAction o={o} /></span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Destino</th>
              <th className="px-3 py-2">Etapa</th>
              <th className="px-3 py-2">Viaje</th>
              <th className="px-3 py-2">Presupuesto</th>
              <th className="px-3 py-2">Responsable</th>
              <th className="px-3 py-2">Próxima acción</th>
            </tr>
          </thead>
          <tbody>
            {opps.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Link href={`/app/oportunidades/${o.id}`} className="font-medium text-sky-700 hover:underline">{o.contactName}</Link>
                </td>
                <td className="px-3 py-2">{o.destination || "Destino desconocido"}</td>
                <td className="px-3 py-2">{stageNames.get(o.stageId) ?? "Etapa desactivada"}</td>
                <td className="px-3 py-2">{[formatDay(o.travelStart), o.travelers ? `${o.travelers} viajeros` : ""].filter(Boolean).join(" · ")}</td>
                <td className="px-3 py-2">{budget(o.budgetAmount, o.budgetCurrency)}</td>
                <td className="px-3 py-2">{memberName(members, o.ownerId)}</td>
                <td className="px-3 py-2"><NextAction o={o} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OpportunityCard({ o, members }: { o: Opp; members: Member[] }) {
  return (
    <Link href={`/app/oportunidades/${o.id}`} className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-2 text-sm hover:border-sky-400">
      <span className="font-medium text-slate-900">{o.contactName}</span>
      <span className="text-slate-700">{o.destination || "Destino desconocido"}</span>
      <span className="text-xs text-slate-500">
        {[formatDay(o.travelStart), o.travelers ? `${o.travelers} viajeros` : "", budget(o.budgetAmount, o.budgetCurrency)].filter(Boolean).join(" · ")}
      </span>
      <span className="text-xs text-slate-500">{memberName(members, o.ownerId)}</span>
      {o.stageKind === "abierta" &&
        (o.nextActionAt ? (
          <span className="text-xs text-slate-700">Próxima: {o.nextActionTitle} · {fechaHora.format(new Date(o.nextActionAt))}</span>
        ) : (
          <span className="text-xs font-semibold text-red-700">Sin próxima acción</span>
        ))}
    </Link>
  );
}
