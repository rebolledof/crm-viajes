import { firstParams } from "@/domain/params";
import Link from "next/link";
import { ActionForm, Input } from "@/components/form";
import { Field, Notice, buttonClass, linkButtonClass, PageHeader } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { EDIT_LEVEL_SHORT, TRIGGER_LABELS, describeDelay } from "@/domain/followups";
import { LOSS_REASON_LABELS } from "@/domain/pipeline";
import { can } from "@/domain/permissions";
import { TASK_KIND_LABELS } from "@/domain/tasks";
import { getSettings, listTemplates } from "@/server/followups";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { Flash, memberName, type SearchParams } from "../crm-ui";
import { updateSettingsAction } from "../followup-actions";

/** Plantillas de seguimiento y ajustes (SPEC-002b). */
export default async function SeguimientosPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = firstParams(await searchParams);
  const [templates, settings, members] = await withUser(getDb(), user, (tx) =>
    Promise.all([listTemplates(tx, user.id, active.agencyId), getSettings(tx, user.id, active.agencyId), activeMembers(tx, user.id, active.agencyId)]),
  );
  const isAdmin = can(active.role, "followups.manage");
  const canPersonal = active.role === "asesor" && settings.allowPersonalTemplates;
  const agency = templates.filter((t) => !t.ownerId);
  const personal = templates.filter((t) => t.ownerId);

  const card = (t: (typeof templates)[number]) => (
    <li key={t.id} className={`flex flex-col gap-2 rounded-md border border-slate-200 p-3 ${t.active ? "bg-surface" : "bg-slate-100"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={`/app/seguimientos/${t.id}`} className="font-medium text-sky-700 hover:underline">{t.name}</Link>
        {!t.active && <span className="text-xs font-semibold uppercase text-slate-500">Inactiva</span>}
        <span className="text-sm text-slate-600">
          {t.trigger === "etapa" ? `Entra en ${t.stageName}` : TRIGGER_LABELS[t.trigger]}
          {t.lossReasons.length > 0 && ` (${t.lossReasons.map((r) => LOSS_REASON_LABELS[r]).join(", ")})`}
          {" · "}
          {EDIT_LEVEL_SHORT[t.editLevel]}
          {t.ownerId && ` · personal de ${memberName(members, t.ownerId)}`}
        </span>
      </div>
      <ol className="ml-4 list-decimal text-sm text-slate-700">
        {t.steps.map((s) => (
          <li key={s.id}>
            {describeDelay(s.delayAmount, s.delayUnit, s.atTime)}: {TASK_KIND_LABELS[s.kind]} · {s.title}
            {s.locked && " (bloqueado)"}
          </li>
        ))}
      </ol>
      {t.steps.length === 0 && <p className="text-sm text-slate-500">Sin pasos todavía.</p>}
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="repeat"
        title="Plantillas de seguimiento"
        actions={(isAdmin || canPersonal) && <Link href="/app/seguimientos/nueva" className={buttonClass}>{isAdmin ? "Nueva plantilla" : "Nueva plantilla personal"}</Link>}
      >
          <p className="max-w-3xl text-sm text-slate-600">
            Crean tareas solas cuando llega una oportunidad o cambia de etapa, con fecha dentro del horario laboral y un mensaje sugerido. Las pendientes se cancelan solas cuando la oportunidad avanza. Nada se envía automáticamente.
          </p>
      </PageHeader>
      <Flash sp={sp} />

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">De la agencia ({agency.length})</h2>
        {agency.length === 0 ? <Notice>La agencia no tiene plantillas.</Notice> : <ul className="flex flex-col gap-2">{agency.map(card)}</ul>}
      </section>

      {(personal.length > 0 || canPersonal) && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium text-slate-900">{isAdmin ? "Personales de los asesores" : "Mis plantillas personales"} ({personal.length})</h2>
          {personal.length === 0 ? (
            <Notice>Aún no tienes plantillas personales. Se aplican solo a las oportunidades de las que eres responsable.</Notice>
          ) : (
            <ul className="flex flex-col gap-2">{personal.map(card)}</ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-slate-900">Horario laboral y permisos</h2>
        {isAdmin ? (
          <ActionForm action={updateSettingsAction} className="grid gap-4 rounded-lg border border-slate-200 bg-surface p-4 sm:grid-cols-4">
            <Field label="Lunes a viernes, abre">
              <Input name="weekdayStart" type="time" required defaultValue={settings.weekdayStart} />
            </Field>
            <Field label="Lunes a viernes, cierra">
              <Input name="weekdayEnd" type="time" required defaultValue={settings.weekdayEnd} />
            </Field>
            <Field label="Sábado, abre (vacío = no se trabaja)">
              <Input name="saturdayStart" type="time" defaultValue={settings.saturdayStart ?? ""} />
            </Field>
            <Field label="Sábado, cierra">
              <Input name="saturdayEnd" type="time" defaultValue={settings.saturdayEnd ?? ""} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-4">
              <input type="checkbox" name="allowPersonalTemplates" defaultChecked={settings.allowPersonalTemplates} />
              Los asesores pueden crear plantillas personales (solo se aplican a sus oportunidades)
            </label>
            <p className="text-xs text-slate-500 sm:col-span-4">Hora de Colombia. El domingo no se trabaja. Los festivos aún no se descuentan.</p>
            <div className="sm:col-span-4">
              <button className={buttonClass}>Guardar ajustes</button>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm text-slate-700">
            Lunes a viernes de {settings.weekdayStart} a {settings.weekdayEnd}
            {settings.saturdayStart ? `; sábado de ${settings.saturdayStart} a ${settings.saturdayEnd}` : "; sábado no se trabaja"}. Plantillas personales:{" "}
            {settings.allowPersonalTemplates ? "permitidas" : "no permitidas"}.
          </p>
        )}
      </section>
      <Link href="/app/tareas" className={linkButtonClass}>Ver las tareas</Link>
    </div>
  );
}
