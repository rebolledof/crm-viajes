import { firstParams } from "@/domain/params";
import Link from "next/link";
import { Chip, Notice, PageHeader, inputClass, buttonClass, linkButtonClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import { dueState } from "@/domain/tasks";
import { getDb, withUser } from "@/db/client";
import { STAGE_KIND_LABELS } from "@/domain/pipeline";
import { listOpportunities, listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { DueChip, Flash, budget, fechaHora, formatDay, memberName, type Member, type SearchParams } from "../crm-ui";

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
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="kanban"
        title="Oportunidades"
        actions={
        <nav aria-label="Vista" className="flex rounded-md border border-slate-300 bg-surface p-0.5 text-sm">
          {(["tablero", "lista"] as const).map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={view === v ? "page" : undefined}
              className={`rounded px-3 py-1.5 ${view === v ? "bg-brand font-medium text-brand-contrast" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {v === "tablero" ? "Tablero" : "Lista"}
            </Link>
          ))}
        </nav>
        }
      >
        <p className="text-sm text-slate-600">Cada columna es un paso del proceso. Las oportunidades avanzan de izquierda a derecha hasta cerrarse.</p>
      </PageHeader>
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
        Para crear una oportunidad abre la ficha del contacto. <Link href="/app/contactos" className={linkButtonClass}>Ir a contactos</Link>
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
        <div className="flex items-stretch">
          {stages.map((s, i) => {
            const list = byStage.get(s.id) ?? [];
            const head = s.kind === "ganada" ? "border-t-emerald-600" : s.kind === "perdida" ? "border-t-red-600" : "border-t-brand";
            return (
              <div key={s.id} className="flex shrink-0 items-stretch">
                {i > 0 && (
                  <span aria-hidden className="flex w-5 items-start justify-center pt-3 text-slate-400">
                    <Icon name="right" className="size-4" />
                  </span>
                )}
                <section aria-label={s.name} className={`flex w-64 flex-col gap-2 rounded border border-t-[3px] border-line bg-slate-100 p-2 ${head}`}>
                  <header className="px-1">
                    <h2 className="flex items-baseline justify-between gap-2 text-sm font-semibold text-slate-900">
                      <span>{s.name}</span>
                      <span className="rounded-full bg-surface px-2 text-xs font-medium text-slate-600">{s.kind !== "abierta" ? `${STAGE_KIND_LABELS[s.kind]} · ` : ""}{list.length}</span>
                    </h2>
                    {s.goal && <p className="mt-0.5 text-xs text-slate-600"><span className="font-medium">Meta:</span> {s.goal}</p>}
                  </header>
                  {list.length === 0 && <p className="px-1 py-3 text-center text-xs text-slate-600">Sin oportunidades en esta etapa.</p>}
                  {list.map((o) => (
                    <OpportunityCard key={o.id} o={o} members={members} />
                  ))}
                </section>
              </div>
            );
          })}
          {orphan.length > 0 && (
            <section aria-label="Etapas desactivadas" className="ml-5 flex w-64 shrink-0 flex-col gap-2 rounded border border-line bg-slate-100 p-2">
              <h2 className="px-1 text-sm font-semibold text-slate-800">En etapas desactivadas · {orphan.length}</h2>
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
    <span className="font-semibold text-red-700">Sin siguiente paso</span>
  );
}

function OpportunityList({ opps, members, stageNames }: { opps: Opp[]; members: Member[]; stageNames: Map<string, string> }) {
  return (
    <>
      <p className="text-sm text-slate-600" role="status">{opps.length === 1 ? "1 oportunidad" : `${opps.length} oportunidades`}</p>
      <ul className="flex flex-col gap-2 md:hidden">
        {opps.map((o) => (
          <li key={o.id}>
            <Link href={`/app/oportunidades/${o.id}`} className="flex flex-col gap-1 rounded-md border border-slate-200 bg-surface p-3 text-sm hover:border-brand">
              <span className="font-medium text-slate-900">{o.contactName}</span>
              <span className="text-slate-700">{o.destination || "Destino desconocido"} · {stageNames.get(o.stageId) ?? "Etapa desactivada"}</span>
              <span className="text-xs text-slate-500">{[formatDay(o.travelStart), budget(o.budgetAmount, o.budgetCurrency), memberName(members, o.ownerId)].filter(Boolean).join(" · ")}</span>
              <span className="text-xs"><NextAction o={o} /></span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-surface md:block">
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
                  <Link href={`/app/oportunidades/${o.id}`} className="font-medium text-brand-text hover:underline">{o.contactName}</Link>
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
  const now = new Date();
  const late = o.stageKind === "abierta" && (!o.nextActionAt || dueState(new Date(o.nextActionAt), now) === "vencida");
  return (
    <Link
      href={`/app/oportunidades/${o.id}`}
      className={`flex flex-col gap-1 rounded border border-line border-l-[3px] bg-surface p-2 text-sm shadow-[0_1px_1px_rgba(0,0,0,0.05)] hover:border-brand ${late ? "border-l-red-600" : "border-l-transparent"}`}
    >
      <span className="font-semibold text-slate-900">{o.contactName}</span>
      <span className="text-slate-700">{o.destination || "Destino sin definir"}</span>
      <span className="text-xs text-slate-500">
        {[formatDay(o.travelStart), o.travelers ? `${o.travelers} viajeros` : "", budget(o.budgetAmount, o.budgetCurrency)].filter(Boolean).join(" · ")}
      </span>
      <span className="text-xs text-slate-500">{memberName(members, o.ownerId)}</span>
      {o.stageKind === "abierta" &&
        (o.nextActionAt ? (
          <span className="flex flex-col items-start gap-1 border-t border-slate-100 pt-1 text-xs text-slate-700">
            <span className="max-w-full truncate">Siguiente: {o.nextActionTitle}</span>
            <DueChip dueAt={new Date(o.nextActionAt)} now={now} />
          </span>
        ) : (
          <span className="border-t border-slate-100 pt-1">
            <Chip tone="red" icon="alert">Sin siguiente paso</Chip>
          </span>
        ))}
    </Link>
  );
}
