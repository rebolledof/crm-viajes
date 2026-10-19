// Piezas de interfaz compartidas por las pantallas de SPEC-002. Componentes de servidor: los
// formularios envían a las acciones de crm-actions.ts, que validan todo otra vez en servidor.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, Notice, buttonClass, inputClass } from "@/components/ui";
import { CURRENCIES, formatMoney, isCurrency } from "@/domain/money";
import { LOSS_REASON_LABELS, isLossReason } from "@/domain/pipeline";
import { PRIORITIES, PRIORITY_LABELS, TASK_KINDS, TASK_KIND_LABELS, dueState, isTaskKind, toBogotaInput } from "@/domain/tasks";
import { AppError, ERROR_MESSAGES, isErrorCode } from "@/server/errors";
import { cancelTaskAction, completeTaskAction, createTaskAction } from "./crm-actions";

export type SearchParams = Promise<Record<string, string | undefined>>;
export type Member = { userId: string; email: string; role: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Carga un registro por id de la URL; responde 404 si el id no es válido o no es de la agencia. */
export async function loadOr404<T>(id: string, load: () => Promise<T>): Promise<T> {
  if (!UUID.test(id)) notFound();
  try {
    return await load();
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  }
}

export const fechaHora = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });
export const fecha = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "UTC" });

/** Fecha de una columna `date` ("2026-12-20"), sin corrimiento de zona horaria. */
export function formatDay(value: string | null): string {
  return value ? fecha.format(new Date(`${value}T00:00:00Z`)) : "";
}

export function memberName(members: Member[], id: string | null): string {
  if (!id) return "Sin responsable";
  return members.find((m) => m.userId === id)?.email ?? "Persona retirada";
}

export function budget(amount: string | null, currency: string | null): string {
  return amount && isCurrency(currency) ? formatMoney(amount, currency) : "";
}

const OK_MESSAGES: Record<string, string> = {
  creado: "Contacto creado.",
  guardado: "Cambios guardados.",
  consentimiento: "Consentimiento registrado.",
  creada: "Creada.",
  guardada: "Cambios guardados.",
  etapa: "Etapa actualizada.",
  tarea: "Tarea creada.",
  completada: "Tarea completada.",
  cancelada: "Tarea cancelada.",
};

export function Flash({ sp }: { sp: Record<string, string | undefined> }) {
  if (isErrorCode(sp.error)) {
    return (
      <Notice tone="error">
        {ERROR_MESSAGES[sp.error]}
        {sp.error === "duplicate_contact" && sp.existente && (
          <>
            {" "}
            <Link href={`/app/contactos/${encodeURIComponent(sp.existente)}`} className="font-medium underline">
              Abrir el contacto existente
            </Link>
          </>
        )}
      </Notice>
    );
  }
  if (sp.ok && OK_MESSAGES[sp.ok]) return <Notice tone="ok">{OK_MESSAGES[sp.ok]}</Notice>;
  return null;
}

export function MemberSelect({ name, members, value, emptyLabel }: { name: string; members: Member[]; value?: string | null; emptyLabel?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className={inputClass}>
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>{m.email}</option>
      ))}
    </select>
  );
}

export type ContactValues = {
  id?: string;
  fullName?: string;
  phones?: string[];
  emails?: string[];
  language?: string | null;
  city?: string | null;
  tags?: string[];
  ownerId?: string | null;
  source?: string | null;
  notes?: string | null;
};

export function ContactForm({ action, members, values = {}, submit }: { action: (fd: FormData) => Promise<void>; members: Member[]; values?: ContactValues; submit: string }) {
  const phones = [...(values.phones ?? []), "", ""].slice(0, Math.max(2, (values.phones?.length ?? 0) + 1));
  const emails = [...(values.emails ?? []), ""].slice(0, Math.max(1, (values.emails?.length ?? 0) + 1));
  return (
    <form action={action} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
      {values.id && <input type="hidden" name="contactId" value={values.id} />}
      <div className="sm:col-span-2">
        <Field label="Nombre completo">
          <input name="fullName" defaultValue={values.fullName} required maxLength={160} className={inputClass} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Teléfonos (el primero es el preferido)</legend>
        {phones.map((p, i) => (
          <input key={i} name="phone" defaultValue={p} inputMode="tel" placeholder="300 123 4567 o +34 600 000 000" aria-label={`Teléfono ${i + 1}`} className={inputClass} />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Correos (el primero es el preferido)</legend>
        {emails.map((e, i) => (
          <input key={i} name="email" type="email" defaultValue={e} aria-label={`Correo ${i + 1}`} className={inputClass} />
        ))}
      </fieldset>
      <Field label="Ciudad">
        <input name="city" defaultValue={values.city ?? ""} className={inputClass} />
      </Field>
      <Field label="Idioma (código de 2 letras, por ejemplo es)">
        <input name="language" defaultValue={values.language ?? ""} maxLength={2} className={inputClass} />
      </Field>
      <Field label="Responsable">
        <MemberSelect name="ownerId" members={members} value={values.ownerId} emptyLabel="Sin responsable" />
      </Field>
      <Field label="Origen (por ejemplo Instagram, referido)">
        <input name="source" defaultValue={values.source ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Etiquetas separadas por coma">
          <input name="tags" defaultValue={(values.tags ?? []).join(", ")} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Notas">
          <textarea name="notes" defaultValue={values.notes ?? ""} rows={3} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <button className={buttonClass}>{submit}</button>
      </div>
    </form>
  );
}

export type OpportunityValues = {
  id?: string;
  contactId?: string;
  ownerId?: string | null;
  source?: string | null;
  destination?: string | null;
  product?: string | null;
  travelStart?: string | null;
  travelEnd?: string | null;
  dateFlexibility?: string | null;
  travelers?: number | null;
  budgetAmount?: string | null;
  budgetCurrency?: string | null;
  priority?: string;
  notes?: string | null;
};

export function OpportunityForm({
  action,
  members,
  values = {},
  stages,
  submit,
}: {
  action: (fd: FormData) => Promise<void>;
  members: Member[];
  values?: OpportunityValues;
  stages?: { id: string; name: string }[];
  submit: string;
}) {
  return (
    <form action={action} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
      {values.id && <input type="hidden" name="opportunityId" value={values.id} />}
      {values.contactId && <input type="hidden" name="contactId" value={values.contactId} />}
      <Field label="Destino">
        <input name="destination" defaultValue={values.destination ?? ""} className={inputClass} />
      </Field>
      <Field label="Producto (por ejemplo paquete, tiquetes, crucero)">
        <input name="product" defaultValue={values.product ?? ""} className={inputClass} />
      </Field>
      <Field label="Fecha de ida">
        <input name="travelStart" type="date" defaultValue={values.travelStart ?? ""} className={inputClass} />
      </Field>
      <Field label="Fecha de regreso">
        <input name="travelEnd" type="date" defaultValue={values.travelEnd ?? ""} className={inputClass} />
      </Field>
      <Field label="Flexibilidad de fechas">
        <input name="dateFlexibility" defaultValue={values.dateFlexibility ?? ""} placeholder="Por ejemplo ± 3 días" className={inputClass} />
      </Field>
      <Field label="Viajeros">
        <input name="travelers" type="number" min={1} max={500} defaultValue={values.travelers ?? ""} className={inputClass} />
      </Field>
      <Field label="Presupuesto">
        <input name="budgetAmount" inputMode="decimal" defaultValue={values.budgetAmount ?? ""} placeholder="5.000.000" className={inputClass} />
      </Field>
      <Field label="Moneda del presupuesto">
        <select name="budgetCurrency" defaultValue={values.budgetCurrency ?? "COP"} className={inputClass}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Prioridad">
        <select name="priority" defaultValue={values.priority ?? "media"} className={inputClass}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
      </Field>
      <Field label="Responsable">
        <MemberSelect name="ownerId" members={members} value={values.ownerId} emptyLabel="Sin responsable" />
      </Field>
      <Field label="Origen">
        <input name="source" defaultValue={values.source ?? ""} className={inputClass} />
      </Field>
      {stages && (
        <Field label="Etapa inicial">
          <select name="stageId" defaultValue={stages[0]?.id} className={inputClass}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
      )}
      <div className="sm:col-span-2">
        <Field label="Notas">
          <textarea name="notes" defaultValue={values.notes ?? ""} rows={3} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <button className={buttonClass}>{submit}</button>
      </div>
    </form>
  );
}

export function NewTaskForm({ contactId, opportunityId, members, userId, back, now }: { contactId: string; opportunityId?: string; members: Member[]; userId: string; back: string; now: Date }) {
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  return (
    <form action={createTaskAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="contactId" value={contactId} />
      {opportunityId && <input type="hidden" name="opportunityId" value={opportunityId} />}
      <input type="hidden" name="back" value={back} />
      <div className="sm:col-span-2">
        <Field label="Qué hay que hacer">
          <input name="title" required maxLength={200} placeholder="Llamar para confirmar fechas" className={inputClass} />
        </Field>
      </div>
      <Field label="Tipo">
        <select name="kind" defaultValue="seguimiento" className={inputClass}>
          {TASK_KINDS.map((k) => (
            <option key={k} value={k}>{TASK_KIND_LABELS[k]}</option>
          ))}
        </select>
      </Field>
      <Field label="Vence (hora de Colombia)">
        <input name="dueAt" type="datetime-local" required defaultValue={toBogotaInput(tomorrow).slice(0, 11) + "09:00"} className={inputClass} />
      </Field>
      <Field label="Asignada a">
        <MemberSelect name="assigneeId" members={members} value={userId} />
      </Field>
      <Field label="Prioridad">
        <select name="priority" defaultValue="media" className={inputClass}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <button className={buttonClass}>Crear tarea</button>
      </div>
    </form>
  );
}

const DUE_STYLE = { vencida: "text-red-700", hoy: "text-amber-700", proxima: "text-slate-600" };
const DUE_LABEL = { vencida: "Vencida", hoy: "Hoy", proxima: "Próxima" };

export type TaskRow = { id: string; title: string; kind: string; dueAt: Date; priority: string; assigneeId: string };

export function TaskItem({ task, now, back, canWrite, members, extra }: { task: TaskRow; now: Date; back: string; canWrite: boolean; members: Member[]; extra?: React.ReactNode }) {
  const state = dueState(task.dueAt, now);
  return (
    <li className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-xs font-semibold uppercase ${DUE_STYLE[state]}`}>{DUE_LABEL[state]}</span>
        <span className="font-medium text-slate-900">{task.title}</span>
        <span className="text-sm text-slate-600">
          {isTaskKind(task.kind) ? TASK_KIND_LABELS[task.kind] : task.kind} · {fechaHora.format(task.dueAt)} · {memberName(members, task.assigneeId)}
        </span>
      </div>
      {extra}
      {canWrite && (
        <details className="text-sm">
          <summary className="cursor-pointer text-sky-700">Completar o cancelar</summary>
          <div className="mt-2 flex flex-col gap-3">
            <form action={completeTaskAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="back" value={back} />
              <Field label="Resultado">
                <input name="result" required placeholder="Qué pasó" className={inputClass} />
              </Field>
              <button className={buttonClass}>Completar</button>
            </form>
            <form action={cancelTaskAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="back" value={back} />
              <Field label="Motivo de cancelación">
                <input name="reason" required className={inputClass} />
              </Field>
              <button className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancelar tarea</button>
            </form>
          </div>
        </details>
      )}
    </li>
  );
}

/** Texto legible de una actividad del historial. */
export function describeActivity(kind: string, data: Record<string, unknown>, members: Member[]): string {
  const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "");
  switch (kind) {
    case "contacto.creado":
      return "Contacto creado";
    case "contacto.responsable":
    case "oportunidad.responsable":
      return `Responsable cambiado a ${memberName(members, s("a") || null)}`;
    case "consentimiento.cambiado":
      return `Consentimiento de ${s("channel")} para ${s("purpose")}: ${s("status")}${s("source") ? ` (${s("source")})` : ""}`;
    case "whatsapp.abierto":
      return `WhatsApp abierto: “${s("mensaje")}”`;
    case "oportunidad.creada":
      return `Oportunidad creada${s("destino") ? ` para ${s("destino")}` : ""} en ${s("etapa")}`;
    case "oportunidad.etapa":
    case "oportunidad.reabierta": {
      const motivo = s("motivo");
      const extra = isLossReason(motivo) ? ` (motivo: ${LOSS_REASON_LABELS[motivo]}${s("nota") ? `, ${s("nota")}` : ""})` : s("evidencia") ? ` (evidencia: ${s("evidencia")})` : "";
      const verb = kind === "oportunidad.reabierta" ? "Oportunidad reabierta" : "Etapa cambiada";
      return `${verb}${s("de") || s("a") ? `: ${s("de")} → ${s("a")}` : ""}${extra}${s("razon") ? `. Razón: ${s("razon")}` : ""}`;
    }
    case "tarea.creada":
      return `Tarea creada: ${s("titulo")}`;
    case "tarea.completada":
      return `Tarea completada: ${s("titulo")}. Resultado: ${s("resultado")}`;
    case "tarea.cancelada":
      return `Tarea cancelada: ${s("titulo")}. Motivo: ${s("motivo")}`;
    default:
      return kind;
  }
}
