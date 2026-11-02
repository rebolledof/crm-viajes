import { firstParams } from "@/domain/params";
import { redirect } from "next/navigation";
import { ActionForm, Input, Select } from "@/components/form";
import { Field, Notice, buttonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { STAGE_KINDS, STAGE_KIND_LABELS } from "@/domain/pipeline";
import { can } from "@/domain/permissions";
import { listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { createStageAction, moveStageAction, updateStageAction } from "../crm-actions";
import { Flash, type SearchParams } from "../crm-ui";

const small = "rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40";

/** Configuración del embudo de la agencia; solo administradores (RF-215, RF-217). */
export default async function EmbudoPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "pipeline.manage")) redirect("/app?error=permission_denied");
  const sp = firstParams(await searchParams);
  const stages = await withUser(getDb(), user, (tx) => listStages(tx, user.id, active.agencyId, { includeInactive: true }));
  const order = stages.map((s) => s.id).join(",");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Etapas del embudo</h1>
        <p className="text-sm text-slate-600">
          Cada agencia define sus etapas. Una oportunidad puede saltar a cualquier etapa activa. Desactivar una etapa no mueve las oportunidades que ya están en ella.
        </p>
      </div>
      <Flash sp={sp} />
      <ol className="flex flex-col gap-2">
        {stages.map((s, i) => (
          <li key={s.id} className={`flex flex-wrap items-center gap-3 rounded-md border border-slate-200 p-3 ${s.active ? "bg-white" : "bg-slate-100"}`}>
            <div className="flex gap-1">
              {(["up", "down"] as const).map((dir) => (
                <form key={dir} action={moveStageAction}>
                  <input type="hidden" name="stageId" value={s.id} />
                  <input type="hidden" name="order" value={order} />
                  <input type="hidden" name="direction" value={dir} />
                  <button className={small} disabled={dir === "up" ? i === 0 : i === stages.length - 1} aria-label={dir === "up" ? `Subir ${s.name}` : `Bajar ${s.name}`}>
                    {dir === "up" ? "↑" : "↓"}
                  </button>
                </form>
              ))}
            </div>
            <ActionForm action={updateStageAction} className="flex flex-1 flex-wrap items-center gap-2">
              <input type="hidden" name="stageId" value={s.id} />
              <label className="sr-only" htmlFor={`name-${s.id}`}>Nombre</label>
              <Input id={`name-${s.id}`} name="name" defaultValue={s.name} required maxLength={60} className="flex-1" />
              <button className={small}>Renombrar</button>
            </ActionForm>
            <span className="text-xs text-slate-600">{STAGE_KIND_LABELS[s.kind]}</span>
            <ActionForm action={updateStageAction}>
              <input type="hidden" name="stageId" value={s.id} />
              <input type="hidden" name="active" value={s.active ? "false" : "true"} />
              <button className={small}>{s.active ? "Desactivar" : "Activar"}</button>
            </ActionForm>
          </li>
        ))}
      </ol>
      {stages.length === 0 && <Notice>La agencia no tiene etapas.</Notice>}
      <ActionForm action={createStageAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Nueva etapa">
          <Input name="name" required maxLength={60} />
        </Field>
        <Field label="Tipo">
          <Select name="kind" defaultValue="abierta">
            {STAGE_KINDS.map((k) => (
              <option key={k} value={k}>{STAGE_KIND_LABELS[k]}</option>
            ))}
          </Select>
        </Field>
        <button className={buttonClass}>Agregar</button>
      </ActionForm>
    </div>
  );
}
