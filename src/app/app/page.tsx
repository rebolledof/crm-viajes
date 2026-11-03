import { Field, Notice, buttonClass, inputClass } from "@/components/ui";
import { ROLE_LABELS, can } from "@/domain/permissions";
import { ERROR_MESSAGES, isErrorCode } from "@/server/errors";
import { requireActiveAgency } from "@/server/session";
import { renameAgencyAction } from "./actions";

export default async function AppHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { active } = await requireActiveAgency();
  const sp = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{active.agencyName}</h1>
        <p className="text-sm text-slate-600">Tu rol: {ROLE_LABELS[active.role]}</p>
      </div>
      {isErrorCode(sp.error) && <Notice tone="error">{ERROR_MESSAGES[sp.error]}</Notice>}
      {sp.ok === "agencia" && <Notice tone="ok">Nombre de la agencia actualizado.</Notice>}
      <Notice>
        Esta es la base del sistema. Contactos, oportunidades y la bandeja llegan en los próximos sprints.
      </Notice>
      {can(active.role, "agency.update") && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-900">Datos de la agencia</h2>
          <form action={renameAgencyAction} className="flex flex-wrap items-end gap-3">
            <Field label="Nombre">
              <input id="name" name="name" defaultValue={active.agencyName} required minLength={2} maxLength={120} className={inputClass} />
            </Field>
            <button className={buttonClass}>Guardar</button>
          </form>
        </section>
      )}
    </div>
  );
}
