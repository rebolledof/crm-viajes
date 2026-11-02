import { firstParams } from "@/domain/params";
import Link from "next/link";
import { Card, Notice, PageHeader, linkButtonClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import { getDb, withUser } from "@/db/client";
import { ROLE_LABELS } from "@/domain/permissions";
import { dayPlan, type PlanStep } from "@/domain/guide";
import { dueState } from "@/domain/tasks";
import { requireActiveAgency } from "@/server/session";
import { inboxCounts } from "@/server/inbox";
import { activeMembers, contactChannels, myDay } from "@/server/tasks";
import { Flash, TaskItem, fechaHora, type SearchParams } from "./crm-ui";

const diaLargo = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" });

/**
 * Mi día (RF-210 y RF-245): el plan del día como un camino de pasos, las tareas agrupadas por
 * urgencia y las oportunidades que se quedaron sin siguiente paso.
 */
export default async function AppHome({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = firstParams(await searchParams);
  const now = new Date();
  const [day, members, inbox] = await withUser(getDb(), user, (tx) =>
    Promise.all([myDay(tx, user.id, active.agencyId, now), activeMembers(tx, user.id, active.agencyId), inboxCounts(tx, user.id, active.agencyId, now)]),
  );
  const channels = await withUser(getDb(), user, (tx) => contactChannels(tx, user.id, active.agencyId, [...day.due, ...day.upcoming].map((d) => d.task.contactId)));
  const overdue = day.due.filter((d) => dueState(d.task.dueAt, now) === "vencida");
  const today = day.due.filter((d) => dueState(d.task.dueAt, now) !== "vencida");
  // Lectura no responde mensajes: su plan no lleva ese paso.
  const plan = dayPlan({ overdue: overdue.length, today: today.length, withoutNext: day.withoutNextAction.length, unanswered: active.role === "lectura" ? undefined : inbox.unansweredMine });
  const total = day.doneToday + day.due.length;
  // El botón relleno va en la primera tarea con canal (WhatsApp o correo): es lo que toca hacer ya.
  const firstId = day.due.find((d) => d.task.kind === "whatsapp" || d.task.kind === "correo")?.task.id;
  const fechaHoy = diaLargo.format(now);

  const row = ({ task, contactName, destination, stageName }: (typeof day.due)[number]) => (
    <TaskItem
      key={task.id}
      task={task}
      now={now}
      back="/app"
      role={active.role}
      members={members}
      channels={channels}
      stageName={stageName}
      primary={task.id === firstId}
      extra={
        <Link href={task.opportunityId ? `/app/oportunidades/${task.opportunityId}` : `/app/contactos/${task.contactId}`} className="text-brand-text hover:underline">
          {contactName}
          {destination ? ` · ${destination}` : ""}
        </Link>
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="home"
        eyebrow={fechaHoy.charAt(0).toUpperCase() + fechaHoy.slice(1)}
        title="Mi día"
        actions={<Link href="/app/tareas" className={linkButtonClass}>Ver todas las tareas</Link>}
      >
        <p className="text-sm text-slate-600">{active.agencyName} · {ROLE_LABELS[active.role]}</p>
      </PageHeader>
      <Flash sp={sp} />
      {active.role === "admin" && inbox.unansweredTeam > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">
          <Icon name="alert" className="size-5" />
          <span className="min-w-0 flex-1">
            <b>{inbox.unansweredTeam === 1 ? "1 conversación del equipo sin responder" : `${inbox.unansweredTeam} conversaciones del equipo sin responder`}</b>: pasaron el tiempo máximo en horario laboral.
          </span>
          <Link href="/app/bandeja?f=sin_responder" className="rounded border border-red-300 bg-surface px-3 py-1.5 font-medium text-red-800 hover:bg-red-100">Ver en la bandeja</Link>
        </div>
      )}

      <Card title="Tu plan de hoy" icon="flag" actions={total > 0 ? <Progress done={day.doneToday} total={total} /> : null}>
        <p className="mb-3 text-sm text-slate-600">Sigue los pasos en orden. Cuando termines uno, pasa al siguiente.</p>
        <PlanStrip steps={plan} />
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {overdue.length > 0 && (
            <Card id="vencidas" title={<span className="text-red-800">Vencidas: hazlas primero ({overdue.length})</span>} icon="alert" bodyClassName="px-4">
              <ul>{overdue.map(row)}</ul>
            </Card>
          )}
          <Card id="hoy" title={`Para hoy (${today.length})`} icon="calendar" bodyClassName="px-4">
            {today.length === 0 ? (
              <div className="py-4">
                <Notice>
                  {overdue.length > 0 ? "No hay más tareas para hoy. Atiende primero las vencidas." : "No tienes tareas para hoy. Revisa las oportunidades sin siguiente paso o crea una tarea desde un contacto."}
                </Notice>
              </div>
            ) : (
              <ul>{today.map(row)}</ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card id="sin-paso" title={`Sin siguiente paso (${day.withoutNextAction.length})`} icon="flag">
            {day.withoutNextAction.length === 0 ? (
              <Notice tone="ok">Todas tus oportunidades abiertas tienen un siguiente paso.</Notice>
            ) : (
              <>
                <p className="mb-2 text-sm text-slate-600">Estas oportunidades no tienen ninguna tarea. Define qué sigue para que no se enfríen.</p>
                <ul className="flex flex-col">
                  {day.withoutNextAction.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2 text-sm last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">{o.contactName} · {o.destination || "Destino sin definir"}</p>
                        <p className="text-xs text-slate-600">{o.stageName} · sin cambios desde {fechaHora.format(o.updatedAt)}</p>
                      </div>
                      <Link href={`/app/oportunidades/${o.id}#nueva-tarea`} className="inline-flex items-center gap-1 rounded border border-accent px-2.5 py-1 text-xs font-semibold text-accent-text hover:bg-accent-soft">
                        Definir paso <Icon name="arrow" className="size-3.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title={`Próximos días (${day.upcoming.length})`} icon="clock" bodyClassName="px-4">
            {day.upcoming.length === 0 ? (
              <div className="py-4">
                <Notice>No tienes tareas para los próximos días. Cada vez que completes una tarea, el sistema te pedirá el siguiente paso.</Notice>
              </div>
            ) : (
              <ul className="flex flex-col">
                {day.upcoming.slice(0, 8).map(({ task, contactName, destination }) => (
                  <li key={task.id} className="flex items-center gap-2 border-b border-slate-100 py-2 text-sm last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{task.title}</p>
                      <Link href={task.opportunityId ? `/app/oportunidades/${task.opportunityId}` : `/app/contactos/${task.contactId}`} className="text-xs text-brand-text hover:underline">
                        {contactName}
                        {destination ? ` · ${destination}` : ""}
                      </Link>
                    </div>
                    <span className="whitespace-nowrap text-xs text-slate-600">{fechaHora.format(task.dueAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const STEP_HREF: Record<PlanStep["key"], string | null> = { mensajes: "/app/bandeja?f=sin_responder", vencidas: "#vencidas", hoy: "#hoy", sin_paso: "#sin-paso", listo: null };

/** Los cuatro pasos del día con flechas entre ellos; el actual resalta con el color de la agencia. */
function PlanStrip({ steps }: { steps: PlanStep[] }) {
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
      {steps.map((s, i) => {
        const tone =
          s.state === "actual"
            ? "border-brand bg-brand text-brand-contrast"
            : s.state === "hecho"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-slate-200 bg-slate-50 text-slate-700";
        const href = s.count > 0 ? STEP_HREF[s.key] : null;
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <span className={`flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${s.state === "actual" ? "bg-brand-contrast text-brand" : s.state === "hecho" ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-700"}`}>
                {s.state === "hecho" ? <Icon name="done" className="size-3" /> : i + 1}
              </span>
              {s.title}
            </span>
            <span className={`text-xs ${s.state === "actual" ? "opacity-90" : "text-slate-600"}`}>{s.detail}</span>
          </>
        );
        return (
          <li key={s.key} aria-current={s.state === "actual" ? "step" : undefined} className="flex flex-1 flex-col items-stretch sm:flex-row sm:items-center">
            {href ? (
              <a href={href} className={`flex flex-1 flex-col gap-0.5 rounded border px-3 py-2 hover:brightness-95 ${tone}`}>{body}</a>
            ) : (
              <div className={`flex flex-1 flex-col gap-0.5 rounded border px-3 py-2 ${tone}`}>{body}</div>
            )}
            {i < steps.length - 1 && (
              <span aria-hidden className="flex justify-center py-0.5 text-slate-400 sm:px-1 sm:py-0">
                <Icon name="arrow" className="size-4 rotate-90 sm:rotate-0" />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = Math.round((done / total) * 100);
  return (
    <span className="flex items-center gap-2 text-xs text-slate-600">
      <span>{done} de {total} hechas</span>
      <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del día">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
