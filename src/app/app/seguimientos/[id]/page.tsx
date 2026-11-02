import { firstParams } from "@/domain/params";
import Link from "next/link";
import { Notice, linkButtonClass, PageHeader } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { EDIT_LEVEL_SHORT, TRIGGER_LABELS, describeDelay } from "@/domain/followups";
import { TASK_KIND_LABELS } from "@/domain/tasks";
import { getSettings, getTemplate } from "@/server/followups";
import { listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { Flash, loadOr404, type SearchParams } from "../../crm-ui";
import { addStepAction, deleteStepAction, moveStepAction, setTemplateActiveAction, updateStepAction, updateTemplateAction } from "../../followup-actions";
import { StepForm, TemplateForm } from "../followup-ui";

const small = "rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40";

export default async function PlantillaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const { id } = await params;
  const sp = firstParams(await searchParams);
  const [t, stages, settings] = await loadOr404(id, () =>
    withUser(getDb(), user, (tx) => Promise.all([getTemplate(tx, user.id, active.agencyId, id), listStages(tx, user.id, active.agencyId, { includeInactive: true }), getSettings(tx, user.id, active.agencyId)])),
  );
  // Misma regla que el servidor: admin todas; asesor solo las suyas y con plantillas personales habilitadas.
  const writable = active.role === "admin" || (active.role === "asesor" && t.ownerId === user.id && settings.allowPersonalTemplates);
  const stageName = (sid: string | null) => stages.find((s) => s.id === sid)?.name ?? "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="repeat" eyebrow={<Link href="/app/seguimientos" className={linkButtonClass}>Plantillas de seguimiento</Link>} title={t.name}>
        <div>
          <p className="text-sm text-slate-600">
            {t.trigger === "etapa" ? `Se activa al entrar en ${stageName(t.stageId)}` : TRIGGER_LABELS[t.trigger]}
            {t.stopStageId && ` · se detiene en ${stageName(t.stopStageId)}`} · {EDIT_LEVEL_SHORT[t.editLevel]}
            {t.ownerId && " · personal"} · {t.active ? "activa" : "inactiva"}
          </p>
        </div>
      </PageHeader>
      <Flash sp={sp} />
      {!writable && <Notice>Puedes ver esta plantilla, pero solo un administrador (o su dueño, si están habilitadas las personales) la cambia.</Notice>}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Pasos ({t.steps.length})</h2>
        {t.steps.length === 0 && <Notice>Agrega al menos un paso para que la plantilla cree tareas.</Notice>}
        <ol className="flex flex-col gap-2">
          {t.steps.map((s, i) => (
            <li key={s.id} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-surface p-3">
              <div className="flex flex-wrap items-center gap-3">
                {writable && (
                  <div className="flex gap-1">
                    {(["up", "down"] as const).map((dir) => (
                      <form key={dir} action={moveStepAction}>
                        <input type="hidden" name="stepId" value={s.id} />
                        <input type="hidden" name="templateId" value={t.id} />
                        <input type="hidden" name="direction" value={dir} />
                        <button className={small} disabled={dir === "up" ? i === 0 : i === t.steps.length - 1} aria-label={dir === "up" ? `Subir ${s.title}` : `Bajar ${s.title}`}>
                          {dir === "up" ? "↑" : "↓"}
                        </button>
                      </form>
                    ))}
                  </div>
                )}
                <span className="font-medium text-slate-900">{s.title}</span>
                <span className="text-sm text-slate-600">
                  {TASK_KIND_LABELS[s.kind]} · {describeDelay(s.delayAmount, s.delayUnit, s.atTime)}
                  {s.locked && " · bloqueado"}
                </span>
              </div>
              {s.message && <p className="rounded bg-slate-50 px-2 py-1 text-sm text-slate-700">{s.message}</p>}
              {writable && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-sky-700">Editar o borrar</summary>
                  <div className="mt-2 flex flex-col gap-3">
                    <StepForm action={updateStepAction} templateId={t.id} values={s} submit="Guardar paso" />
                    <form action={deleteStepAction}>
                      <input type="hidden" name="stepId" value={s.id} />
                      <input type="hidden" name="templateId" value={t.id} />
                      <button className="text-sm text-red-700 hover:underline">Borrar este paso (las tareas ya creadas no cambian)</button>
                    </form>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ol>
        {writable && (
          <div className="rounded-lg border border-slate-200 bg-surface p-4">
            <h3 className="mb-3 text-sm font-medium text-slate-900">Agregar paso</h3>
            <StepForm action={addStepAction} templateId={t.id} submit="Agregar" />
          </div>
        )}
      </section>

      {writable && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium text-slate-900">Configuración</h2>
          <TemplateForm action={updateTemplateAction} stages={stages} values={t} submit="Guardar plantilla" />
          <form action={setTemplateActiveAction}>
            <input type="hidden" name="templateId" value={t.id} />
            <input type="hidden" name="active" value={t.active ? "false" : "true"} />
            <button className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              {t.active ? "Desactivar plantilla (deja de crear tareas; las ya creadas siguen)" : "Activar plantilla"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
