// Piezas de interfaz compartidas por las pantallas de SPEC-002. Componentes de servidor: los
// formularios envían a las acciones de crm-actions.ts, que validan todo otra vez en servidor.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Input, Select, Textarea, type FormAction } from "@/components/form";
import { Chip, Field, Notice, buttonClass, secondaryButtonClass } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { CURRENCIES, formatMoney, isCurrency } from "@/domain/money";
import { LOSS_REASON_LABELS, isLossReason } from "@/domain/pipeline";
import { PRIORITIES, PRIORITY_LABELS, TASK_KINDS, TASK_KIND_LABELS, dueState, isTaskKind, toBogotaInput } from "@/domain/tasks";
import { AppError, ERROR_MESSAGES, isErrorCode } from "@/server/errors";
import { cancelTaskAction, completeTaskAction, createTaskAction } from "./crm-actions";
import { updateTaskAction } from "./followup-actions";
import { TaskOpenButton } from "./task-open-button";
import { channelBlock, taskPermissions, type ContactChannels, type EditLevel } from "@/domain/followups";
import type { Role } from "@/domain/permissions";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
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
  clave: "Contraseña actualizada.",
  creado: "Contacto creado.",
  guardado: "Cambios guardados.",
  verificado: "Dato confirmado. Ya se puede usar para escribirle al cliente.",
  consentimiento: "Consentimiento registrado.",
  creada: "Creada.",
  guardada: "Cambios guardados.",
  etapa: "Etapa actualizada.",
  tarea: "Tarea creada.",
  completada: "Tarea completada.",
  cancelada: "Tarea cancelada.",
  tarea_editada: "Tarea ajustada.",
  ajustes: "Ajustes guardados.",
  paso: "Paso agregado.",
  borrado: "Paso borrado.",
  tomada: "Tomaste la conversación. Ahora está en Mías.",
  asignada: "Responsable de la conversación cambiado.",
  resuelta: "Conversación resuelta. Si el cliente vuelve a escribir, se reabre sola.",
  respuesta_creada: "Respuesta guardada creada. Úsala escribiendo / en la caja de respuesta.",
  respuesta_guardada: "Respuesta guardada actualizada.",
  respuesta_borrada: "Respuesta guardada borrada.",
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
    <Select name={name} defaultValue={value ?? ""}>
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {/* Responsable que ya no está en la agencia: se conserva si no se cambia, en vez de borrarse al guardar. */}
      {value && !members.some((m) => m.userId === value) && <option value={value}>Persona que ya no está en la agencia</option>}
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>{m.email}</option>
      ))}
    </Select>
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

export function ContactForm({ action, members, values = {}, submit }: { action: FormAction; members: Member[]; values?: ContactValues; submit: string }) {
  const phones = [...(values.phones ?? []), "", ""].slice(0, Math.max(2, (values.phones?.length ?? 0) + 1));
  const emails = [...(values.emails ?? []), ""].slice(0, Math.max(1, (values.emails?.length ?? 0) + 1));
  return (
    <ActionForm action={action} className="grid gap-4 rounded-lg border border-slate-200 bg-surface p-4 sm:grid-cols-2">
      {values.id && <input type="hidden" name="contactId" value={values.id} />}
      <div className="sm:col-span-2">
        <Field label="Nombre completo">
          <Input name="fullName" defaultValue={values.fullName} required maxLength={160} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Teléfonos (el primero es el preferido)</legend>
        {phones.map((p, i) => (
          <Input key={i} index={i} name="phone" defaultValue={p} inputMode="tel" placeholder="300 123 4567 o +34 600 000 000" aria-label={`Teléfono ${i + 1}`} />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Correos (el primero es el preferido)</legend>
        {emails.map((e, i) => (
          <Input key={i} index={i} name="email" type="email" defaultValue={e} aria-label={`Correo ${i + 1}`} />
        ))}
      </fieldset>
      <Field label="Ciudad">
        <Input name="city" defaultValue={values.city ?? ""} />
      </Field>
      <Field label="Idioma (código de 2 letras, por ejemplo es)">
        <Input name="language" defaultValue={values.language ?? ""} maxLength={2} />
      </Field>
      <Field label="Responsable">
        <MemberSelect name="ownerId" members={members} value={values.ownerId} emptyLabel="Sin responsable" />
      </Field>
      <Field label="Origen (por ejemplo Instagram, referido)">
        <Input name="source" defaultValue={values.source ?? ""} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Etiquetas separadas por coma">
          <Input name="tags" defaultValue={(values.tags ?? []).join(", ")} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Notas">
          <Textarea name="notes" defaultValue={values.notes ?? ""} rows={3} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <button className={buttonClass}>{submit}</button>
      </div>
    </ActionForm>
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
  action: FormAction;
  members: Member[];
  values?: OpportunityValues;
  stages?: { id: string; name: string }[];
  submit: string;
}) {
  return (
    <ActionForm action={action} className="grid gap-4 rounded-lg border border-slate-200 bg-surface p-4 sm:grid-cols-2">
      {values.id && <input type="hidden" name="opportunityId" value={values.id} />}
      {values.contactId && <input type="hidden" name="contactId" value={values.contactId} />}
      <Field label="Destino">
        <Input name="destination" defaultValue={values.destination ?? ""} />
      </Field>
      <Field label="Producto (por ejemplo paquete, tiquetes, crucero)">
        <Input name="product" defaultValue={values.product ?? ""} />
      </Field>
      <Field label="Fecha de ida">
        <Input name="travelStart" type="date" defaultValue={values.travelStart ?? ""} />
      </Field>
      <Field label="Fecha de regreso">
        <Input name="travelEnd" type="date" defaultValue={values.travelEnd ?? ""} />
      </Field>
      <Field label="Flexibilidad de fechas">
        <Input name="dateFlexibility" defaultValue={values.dateFlexibility ?? ""} placeholder="Por ejemplo ± 3 días" />
      </Field>
      <Field label="Viajeros">
        <Input name="travelers" type="number" min={1} max={999} defaultValue={values.travelers ?? ""} />
      </Field>
      <Field label="Presupuesto">
        <Input name="budgetAmount" inputMode="decimal" defaultValue={values.budgetAmount ?? ""} placeholder="5.000.000" />
      </Field>
      <Field label="Moneda del presupuesto">
        <Select name="budgetCurrency" defaultValue={values.budgetCurrency ?? "COP"}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Prioridad">
        <Select name="priority" defaultValue={values.priority ?? "media"}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Responsable">
        <MemberSelect name="ownerId" members={members} value={values.ownerId} emptyLabel="Sin responsable" />
      </Field>
      <Field label="Origen">
        <Input name="source" defaultValue={values.source ?? ""} />
      </Field>
      {stages && (
        <Field label="Etapa inicial">
          <Select name="stageId" defaultValue={stages[0]?.id}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
      )}
      <div className="sm:col-span-2">
        <Field label="Notas">
          <Textarea name="notes" defaultValue={values.notes ?? ""} rows={3} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <button className={buttonClass}>{submit}</button>
      </div>
    </ActionForm>
  );
}

/**
 * Desde la oportunidad, la tarea queda ligada a ella. Desde la ficha del contacto se elige la
 * oportunidad (por defecto la abierta más reciente) para que cuente como su próxima acción.
 */
export function NewTaskForm({
  contactId,
  opportunityId,
  opportunities,
  members,
  userId,
  back,
  now,
}: {
  contactId: string;
  opportunityId?: string;
  opportunities?: { id: string; label: string }[];
  members: Member[];
  userId: string;
  back: string;
  now: Date;
}) {
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  return (
    <ActionForm action={createTaskAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="contactId" value={contactId} />
      {opportunityId && <input type="hidden" name="opportunityId" value={opportunityId} />}
      <input type="hidden" name="back" value={back} />
      <div className="sm:col-span-2">
        <Field label="Qué hay que hacer">
          <Input name="title" required maxLength={200} placeholder="Llamar para confirmar fechas" />
        </Field>
      </div>
      {!opportunityId && opportunities && opportunities.length > 0 && (
        <div className="sm:col-span-2">
          <Field label="Oportunidad">
            <Select name="opportunityId" defaultValue={opportunities[0].id}>
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
              <option value="">Ninguna (tarea solo del contacto)</option>
            </Select>
          </Field>
        </div>
      )}
      <Field label="Tipo">
        <Select name="kind" defaultValue="seguimiento">
          {TASK_KINDS.map((k) => (
            <option key={k} value={k}>{TASK_KIND_LABELS[k]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Vence (hora de Colombia)">
        <Input name="dueAt" type="datetime-local" required defaultValue={toBogotaInput(tomorrow).slice(0, 11) + "09:00"} />
      </Field>
      <Field label="Asignada a">
        <MemberSelect name="assigneeId" members={members} value={userId} />
      </Field>
      <Field label="Prioridad">
        <Select name="priority" defaultValue="media">
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <button className={buttonClass}>Crear tarea</button>
      </div>
    </ActionForm>
  );
}

const DUE_TONE = { vencida: "red", hoy: "amber", proxima: "gray" } as const;
const KIND_ICON: Record<string, IconName> = { llamada: "phone", whatsapp: "message", correo: "mail", reunion: "users", seguimiento: "repeat", recordatorio: "clock", tarea: "check" };

const hora = new Intl.DateTimeFormat("es-CO", { timeStyle: "short", timeZone: "America/Bogota" });

/** "Vencida · ayer 6:01 p. m.", "Hoy · 4:00 p. m." o la fecha completa. */
export function dueLabel(dueAt: Date, now: Date): string {
  const state = dueState(dueAt, now);
  if (state === "hoy") return `Hoy · ${hora.format(dueAt)}`;
  return `${state === "vencida" ? "Vencida · " : ""}${fechaHora.format(dueAt)}`;
}

export function DueChip({ dueAt, now }: { dueAt: Date; now: Date }) {
  const state = dueState(dueAt, now);
  return (
    <Chip tone={DUE_TONE[state]} icon={state === "vencida" ? "alert" : state === "hoy" ? "clock" : "calendar"}>
      {dueLabel(dueAt, now)}
    </Chip>
  );
}

export type TaskRow = {
  id: string;
  contactId?: string;
  title: string;
  kind: string;
  dueAt: Date;
  priority: string;
  assigneeId: string;
  templateId?: string | null;
  message?: string | null;
  editLevel?: EditLevel | null;
};

/**
 * Una tarea con sus acciones (SPEC-002c): un solo botón principal según el tipo, la etapa de la
 * oportunidad y el vencimiento a la vista. Lo que se ofrece depende del rol y del nivel de edición
 * de la tarea (SPEC-002b RF-226); el servidor y la base vuelven a comprobarlo.
 */
export function TaskItem({
  task,
  now,
  back,
  role,
  members,
  extra,
  channels,
  stageName,
  primary,
}: {
  task: TaskRow;
  now: Date;
  back: string;
  role: Role;
  members: Member[];
  extra?: React.ReactNode;
  /** Teléfono, correo y permisos de los contactos (contactChannels) para deshabilitar el botón del canal. */
  channels?: Map<string, ContactChannels>;
  /** Etapa de la oportunidad de la tarea, para que el asesor sepa en qué paso del proceso está. */
  stageName?: string | null;
  /** Resalta el botón de acción (la primera tarea del plan). */
  primary?: boolean;
}) {
  const perms = taskPermissions(role, task.editLevel);
  const channel = task.kind === "whatsapp" ? "whatsapp" : task.kind === "correo" ? "correo" : null;
  const blocked = channel && task.contactId ? channelBlock(task.kind, channels?.get(task.contactId)) : null;
  const kind = isTaskKind(task.kind) ? task.kind : "tarea";
  return (
    <li className="flex flex-col gap-2 border-b border-slate-100 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600" title={TASK_KIND_LABELS[kind]}>
          <Icon name={KIND_ICON[kind] ?? "check"} className="size-4" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-semibold text-slate-900">{task.title}</p>
          <div className="text-sm text-slate-600">
            {extra}
            {task.assigneeId && members.length > 1 && <span className="text-slate-500"> · {memberName(members, task.assigneeId)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {stageName && <Chip tone="brand" title="Etapa de la oportunidad">Etapa: {stageName}</Chip>}
          {task.templateId && (
            <Chip tone="violet" title="Creada por una plantilla de seguimiento">
              Automática{task.editLevel === "bloqueada" ? " · bloqueada" : ""}
            </Chip>
          )}
          <DueChip dueAt={task.dueAt} now={now} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {perms.complete && channel && <TaskOpenButton taskId={task.id} channel={channel} back={back} blocked={blocked} compact primary={primary} />}
          {task.kind === "llamada" && task.contactId && channels?.get(task.contactId)?.phone === false && (
            <span className="text-xs text-amber-800">El contacto no tiene teléfono. Agrégalo en su ficha para poder llamar.</span>
          )}
        </div>
      </div>
      {task.message && <p className="ml-11 whitespace-pre-line rounded bg-slate-50 px-2 py-1 text-sm text-slate-700">Mensaje sugerido: {task.message}</p>}
      {(perms.complete || perms.adjust || perms.reassign) && (
        <div className="ml-11 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {perms.complete && (
            <details className="group">
              <summary className="cursor-pointer font-medium text-brand-text marker:text-slate-400">{perms.cancel ? "Marcar hecha o cancelar" : "Marcar hecha"}</summary>
              <div className="mt-2 flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-3">
                <ActionForm action={completeTaskAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="back" value={back} />
                  <Field label="¿Qué pasó?">
                    <Input name="result" required placeholder="Por ejemplo: confirmó fechas del 20 al 24" />
                  </Field>
                  <button className={buttonClass}>Marcar hecha</button>
                </ActionForm>
                {perms.cancel && (
                  <ActionForm action={cancelTaskAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="back" value={back} />
                    <Field label="Motivo de cancelación">
                      <Input name="reason" required />
                    </Field>
                    <button className={secondaryButtonClass}>Cancelar tarea</button>
                  </ActionForm>
                )}
              </div>
            </details>
          )}
          {(perms.adjust || perms.reassign) && (
            <details>
              <summary className="cursor-pointer font-medium text-brand-text marker:text-slate-400">Ajustar</summary>
              <ActionForm action={updateTaskAction} className="mt-2 grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="back" value={back} />
                {perms.adjust && (
                  <>
                    <Field label="Vence (hora de Colombia)">
                      <Input name="dueAt" type="datetime-local" required defaultValue={toBogotaInput(task.dueAt)} />
                    </Field>
                    <Field label="Prioridad">
                      <Select name="priority" defaultValue={task.priority}>
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                        ))}
                      </Select>
                    </Field>
                    {(task.message || channel) && (
                      <div className="sm:col-span-2">
                        <Field label="Mensaje sugerido ({nombre}, {destino} y {agencia} se rellenan solos)">
                          <Textarea name="message" defaultValue={task.message ?? ""} rows={3} maxLength={1000} />
                        </Field>
                      </div>
                    )}
                  </>
                )}
                {perms.reassign && (
                  <Field label="Asignada a">
                    <MemberSelect name="assigneeId" members={members} value={task.assigneeId} />
                  </Field>
                )}
                <div className="sm:col-span-2">
                  <button className={buttonClass}>Guardar cambios</button>
                </div>
              </ActionForm>
            </details>
          )}
        </div>
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
    case "contacto.verificado":
      return `${s("dato") === "telefono" ? "Teléfono" : "Correo"} del formulario web confirmado`;
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
    case "tarea.editada":
      return `Tarea ajustada: ${s("titulo")}${s("vence") ? `. Nueva fecha: ${fechaHora.format(new Date(s("vence")))}` : ""}${s("asignada") ? `. Asignada a ${memberName(members, s("asignada"))}` : ""}`;
    case "seguimiento.creado":
      return `Plantilla "${s("plantilla")}": ${String(data.cantidad ?? "")} tareas automáticas creadas`;
    case "seguimiento.cancelado":
      return `${String(data.cantidad ?? "")} tareas automáticas canceladas al pasar a ${s("etapa")}`;
    case "bandeja.recibido":
      return `Mensaje recibido por ${s("canal") === "formulario" ? "el formulario web" : s("canal")}`;
    case "bandeja.tomada":
      return "Tomó la conversación";
    case "bandeja.asignada":
      return data.a ? `Conversación asignada a ${memberName(members, s("a"))}` : "Conversación devuelta a Sin asignar";
    case "bandeja.respuesta":
      return `Respondió por ${s("via") === "correo" ? "correo" : "WhatsApp"} desde la bandeja`;
    case "bandeja.resuelta":
      return "Conversación resuelta";
    case "correo.abierto":
      return `Correo abierto para ${s("correo")}: “${s("asunto")}”`;
    default:
      return kind;
  }
}
