"use server";

// Acciones de servidor de SPEC-002b. La agencia sale de la sesión verificada; los permisos se
// validan en los casos de uso y otra vez en la base (RLS y triggers).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { getDb, withUser } from "@/db/client";
import { isDelayUnit, isEditLevel, isFollowupTrigger } from "@/domain/followups";
import { isLossReason } from "@/domain/pipeline";
import { isPriority, isTaskKind, parseBogotaDateTime } from "@/domain/tasks";
import { AppError, CODE_FIELDS, ERROR_MESSAGES, errorMessage, type ErrorCode } from "@/server/errors";
import { addStep, createTemplate, deleteStep, moveStep, setTemplateActive, updateSettings, updateStep, updateTemplate, type StepInput, type TemplateInput } from "@/server/followups";
import { requireActiveAgency } from "@/server/session";
import { openTaskLink, updateTask } from "@/server/tasks";

const str = (fd: FormData, k: string) => fd.get(k)?.toString() ?? "";
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k)?.toString().trim();
  return v ? v : null;
};

function back(fd: FormData, fallback: string): string {
  const to = str(fd, "back");
  return to.startsWith("/app/") && !to.startsWith("//") ? to : fallback;
}

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

type Failure = { ok: false; code: ErrorCode; field?: string };

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | Failure> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, field: err.field ?? CODE_FIELDS[err.code] };
    console.error(err);
    throw err;
  }
}

function failed(fd: FormData, f: Pick<Failure, "code" | "field">): FormState {
  const values: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$") || typeof v !== "string") continue;
    (values[k] ??= []).push(v);
  }
  return { error: errorMessage(f.code, f.field), field: f.field, values, at: Date.now() };
}

async function ctx() {
  const { user, active } = await requireActiveAgency();
  return { user, agencyId: active.agencyId, db: getDb() };
}

export async function updateSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const r = await run(() =>
    withUser(db, user, (tx) =>
      updateSettings(tx, user.id, agencyId, {
        weekdayStart: str(fd, "weekdayStart"),
        weekdayEnd: str(fd, "weekdayEnd"),
        saturdayStart: opt(fd, "saturdayStart"),
        saturdayEnd: opt(fd, "saturdayEnd"),
        allowPersonalTemplates: fd.get("allowPersonalTemplates") === "on",
      }),
    ),
  );
  if (!r.ok) return failed(fd, r);
  revalidatePath("/app/seguimientos");
  redirect("/app/seguimientos?ok=ajustes");
}

function templateInput(fd: FormData): TemplateInput | null {
  const trigger = str(fd, "trigger");
  const editLevel = str(fd, "editLevel");
  if (!isFollowupTrigger(trigger) || !isEditLevel(editLevel)) return null;
  return {
    name: str(fd, "templateName"),
    trigger,
    stageId: opt(fd, "stageId"),
    lossReasons: fd.getAll("lossReasons").map(String).filter(isLossReason),
    stopStageId: opt(fd, "stopStageId"),
    editLevel,
  };
}

export async function createTemplateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const input = templateInput(fd);
  if (!input) return failed(fd, { code: "invalid_input", field: "trigger" });
  const r = await run(() => withUser(db, user, (tx) => createTemplate(tx, user.id, agencyId, { ...input, personal: fd.get("personal") === "true" })));
  if (!r.ok) return failed(fd, r);
  revalidatePath("/app/seguimientos");
  redirect(`/app/seguimientos/${r.value}?ok=creada`);
}

export async function updateTemplateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "templateId");
  const input = templateInput(fd);
  if (!input) return failed(fd, { code: "invalid_input", field: "trigger" });
  const r = await run(() => withUser(db, user, (tx) => updateTemplate(tx, user.id, agencyId, id, input)));
  if (!r.ok) return failed(fd, r);
  revalidatePath(`/app/seguimientos/${id}`);
  redirect(`/app/seguimientos/${id}?ok=guardada`);
}

export async function setTemplateActiveAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "templateId");
  const r = await run(() => withUser(db, user, (tx) => setTemplateActive(tx, user.id, agencyId, id, str(fd, "active") === "true")));
  if (!r.ok) redirect(`/app/seguimientos/${id}?error=${r.code}`);
  revalidatePath("/app/seguimientos");
  revalidatePath(`/app/seguimientos/${id}`);
  redirect(`/app/seguimientos/${id}?ok=guardada`);
}

function stepInput(fd: FormData): StepInput | null {
  const kind = str(fd, "kind");
  const unit = str(fd, "delayUnit");
  const priority = str(fd, "priority");
  const amount = Number(str(fd, "delayAmount") || "0");
  if (!isTaskKind(kind) || !isDelayUnit(unit)) return null;
  return {
    kind,
    title: str(fd, "title"),
    delayAmount: amount,
    delayUnit: unit,
    atTime: opt(fd, "atTime"),
    priority: isPriority(priority) ? priority : undefined,
    message: opt(fd, "message"),
    locked: fd.get("locked") === "on",
  };
}

export async function addStepAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "templateId");
  const input = stepInput(fd);
  if (!input) return failed(fd, { code: "invalid_input", field: "delayUnit" });
  const r = await run(() => withUser(db, user, (tx) => addStep(tx, user.id, agencyId, id, input)));
  if (!r.ok) return failed(fd, r);
  revalidatePath(`/app/seguimientos/${id}`);
  redirect(`/app/seguimientos/${id}?ok=paso`);
}

export async function updateStepAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "templateId");
  const input = stepInput(fd);
  if (!input) return failed(fd, { code: "invalid_input", field: "delayUnit" });
  const r = await run(() => withUser(db, user, (tx) => updateStep(tx, user.id, agencyId, str(fd, "stepId"), input)));
  if (!r.ok) return failed(fd, r);
  revalidatePath(`/app/seguimientos/${id}`);
  redirect(`/app/seguimientos/${id}?ok=guardada`);
}

export async function deleteStepAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const r = await run(() => withUser(db, user, (tx) => deleteStep(tx, user.id, agencyId, str(fd, "stepId"))));
  const id = str(fd, "templateId");
  if (!r.ok) redirect(`/app/seguimientos/${id}?error=${r.code}`);
  revalidatePath(`/app/seguimientos/${id}`);
  redirect(`/app/seguimientos/${id}?ok=borrado`);
}

export async function moveStepAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const direction = str(fd, "direction") === "up" ? "up" : "down";
  const r = await run(() => withUser(db, user, (tx) => moveStep(tx, user.id, agencyId, str(fd, "stepId"), direction)));
  const id = str(fd, "templateId");
  if (!r.ok) redirect(`/app/seguimientos/${id}?error=${r.code}`);
  revalidatePath(`/app/seguimientos/${id}`);
  redirect(`/app/seguimientos/${id}`);
}

/** Ajustar una tarea (fecha, prioridad, mensaje, asignada) según su nivel de edición. */
export async function updateTaskAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const to = back(fd, "/app");
  const rawDue = fd.get("dueAt");
  const dueAt = rawDue === null ? undefined : parseBogotaDateTime(rawDue.toString());
  if (dueAt === null) return failed(fd, { code: "invalid_input", field: "dueAt" });
  const priority = str(fd, "priority");
  const message = fd.get("message");
  const assigneeId = opt(fd, "assigneeId");
  const r = await run(() =>
    withUser(db, user, (tx) =>
      updateTask(tx, user.id, agencyId, str(fd, "taskId"), {
        dueAt,
        priority: isPriority(priority) ? priority : undefined,
        message: message === null ? undefined : message.toString(),
        assigneeId: assigneeId ?? undefined,
      }),
    ),
  );
  if (!r.ok) return failed(fd, r);
  revalidatePath(to.split("?")[0]);
  redirect(withParam(to, "ok", "tarea_editada"));
}

export type OpenTaskState = { link?: string; channel?: "whatsapp" | "correo"; error?: string; at?: number };

/** Registra la apertura y devuelve el enlace de WhatsApp o de correo; el navegador lo abre. */
export async function openTaskAction(_prev: OpenTaskState, fd: FormData): Promise<OpenTaskState> {
  const { user, agencyId, db } = await ctx();
  const r = await run(() => withUser(db, user, (tx) => openTaskLink(tx, user.id, agencyId, str(fd, "taskId"))));
  if (!r.ok) return { error: ERROR_MESSAGES[r.code], at: Date.now() };
  revalidatePath(back(fd, "/app").split("?")[0]);
  return { ...r.value, at: Date.now() };
}
