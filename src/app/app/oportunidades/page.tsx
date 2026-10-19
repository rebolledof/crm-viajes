import Link from "next/link";
import { Notice, inputClass, buttonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { STAGE_KIND_LABELS } from "@/domain/pipeline";
import { listOpportunities, listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { Flash, budget, fechaHora, formatDay, memberName, type SearchParams } from "../crm-ui";

export default async function OportunidadesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = await searchParams;
  const owner = sp.responsable ?? "mias";
  const [stages, members] = await withUser(getDb(), user, (tx) => Promise.all([listStages(tx, user.id, active.agencyId), activeMembers(tx, user.id, active.agencyId)]));
  const ownerId = owner === "todas" ? undefined : (members.find((m) => m.userId === owner)?.userId ?? user.id);
  const opps = await withUser(getDb(), user, (tx) => listOpportunities(tx, user.id, active.agencyId, { ownerId }));
  const byStage = new Map<string, typeof opps>();
  for (const o of opps) byStage.set(o.stageId, [...(byStage.get(o.stageId) ?? []), o]);
  const activeIds = new Set(stages.map((s) => s.id));
  const orphan = opps.filter((o) => !activeIds.has(o.stageId));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Oportunidades</h1>
        <form className="flex items-center gap-2 text-sm">
          <label htmlFor="responsable" className="text-slate-700">Responsable</label>
          <select id="responsable" name="responsable" defaultValue={owner} className={inputClass}>
            <option value="mias">Mías</option>
            <option value="todas">Todas</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.email}</option>
            ))}
          </select>
          <button className={buttonClass}>Ver</button>
        </form>
      </div>
      <Flash sp={sp} />
      <p className="text-sm text-slate-600">
        Para crear una oportunidad abre la ficha del contacto. <Link href="/app/contactos" className="text-sky-700 underline">Ir a contactos</Link>
      </p>
      {opps.length === 0 && <Notice>No hay oportunidades con este filtro.</Notice>}
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
    </div>
  );
}

type Opp = Awaited<ReturnType<typeof listOpportunities>>[number];

function OpportunityCard({ o, members }: { o: Opp; members: { userId: string; email: string; role: string }[] }) {
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
