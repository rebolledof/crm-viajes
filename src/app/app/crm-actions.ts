"use server";

// Acciones de servidor de SPEC-002. Cada una toma la agencia de la sesión verificada, nunca del
// formulario, y llama a los casos de uso dentro de withUser (RLS + permisos en servidor).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, withUser } from "@/db/client";
import { isLossReason, isStageKind } from "@/domain/pipeline";
import { isPriority, isTaskKind, parseBogotaDateTime } from "@/domain/tasks";
import { createContact, openWhatsapp, recordConsent, updateContact, type ContactInput } from "@/server/contacts";
import { AppError, ERROR_MESSAGES, type ErrorCode } from "@/server/errors";
import { createOpportunity, createStage, moveOpportunity, reorderStages, updateOpportunity, updateStage } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { cancelTask, completeTask, createTask } from "@/server/tasks";

const str = (fd: FormData, k: string) => fd.get(k)?.toString() ?? "";
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k)?.toString().trim();
  return v ? v : null;
};

/** Ruta interna a la que volver; nunca una URL externa enviada por el formulario. */
function back(fd: FormData, fallback: string): string {
  const to = str(fd, "back");
  return to.startsWith("/app/") && !to.startsWith("//") ? to : fallback;
}

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: ErrorCode; detail?: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, detail: err.detail };
    console.error(err);
    throw err;
  }
}

async function ctx() {
  const { user, active } = await requireActiveAgency();
  return { user, agencyId: active.agencyId, db: getDb() };
}

function contactInput(fd: FormData): ContactInput {
  return {
    fullName: str(fd, "fullName"),
    phones: fd.getAll("phone").map((v) => ({ raw: v.toString() })),
    emails: fd.getAll("email").map((v) => v.toString()),
    language: opt(fd, "language"),
    city: opt(fd, "city"),
    tags: str(fd, "tags").split(","),
    ownerId: opt(fd, "ownerId"),
    source: opt(fd, "source"),
    notes: opt(fd, "notes"),
  };
}

export async function createContactAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const r = await run(() => withUser(db, user, (tx) => createContact(tx, user.id, agencyId, contactInput(fd))));
  if (!r.ok) {
    const path = withParam("/app/contactos/nuevo", "error", r.code);
    redirect(r.detail ? withParam(path, "existente", r.detail) : path);
  }
  revalidatePath("/app/contactos");
  redirect(`/app/contactos/${r.value}?ok=creado`);
}

export async function updateContactAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "contactId");
  const r = await run(() => withUser(db, user, (tx) => updateContact(tx, user.id, agencyId, id, contactInput(fd))));
  if (!r.ok) {
    const path = withParam(`/app/contactos/${id}/editar`, "error", r.code);
    redirect(r.detail ? withParam(path, "existente", r.detail) : path);
  }
  revalidatePath(`/app/contactos/${id}`);
  redirect(`/app/contactos/${id}?ok=guardado`);
}

export async function recordConsentAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "contactId");
  const channel = str(fd, "channel");
  const purpose = str(fd, "purpose");
  const status = str(fd, "status");
  if (!["whatsapp", "correo", "telefono"].includes(channel) || !["servicio", "promociones"].includes(purpose) || !["otorgado", "retirado"].includes(status)) {
    redirect(withParam(`/app/contactos/${id}`, "error", "invalid_input"));
  }
  const r = await run(() =>
    withUser(db, user, (tx) =>
      recordConsent(tx, user.id, agencyId, id, {
        channel: channel as "whatsapp" | "correo" | "telefono",
        purpose: purpose as "servicio" | "promociones",
        status: status as "otorgado" | "retirado",
        source: str(fd, "source"),
      }),
    ),
  );
  if (!r.ok) redirect(withParam(`/app/contactos/${id}`, "error", r.code));
  revalidatePath(`/app/contactos/${id}`);
  redirect(`/app/contactos/${id}?ok=consentimiento`);
}

export type WhatsappState = { link?: string; error?: string; at?: number };

/** Registra la apertura y devuelve el enlace; el navegador lo abre en otra pestaña. */
export async function openWhatsappAction(_prev: WhatsappState, fd: FormData): Promise<WhatsappState> {
  const { user, agencyId, db } = await ctx();
  const contactId = str(fd, "contactId");
  const r = await run(() => withUser(db, user, (tx) => openWhatsapp(tx, user.id, agencyId, contactId, { message: str(fd, "message"), opportunityId: opt(fd, "opportunityId") })));
  if (!r.ok) return { error: ERROR_MESSAGES[r.code] };
  revalidatePath(`/app/contactos/${contactId}`);
  return { link: r.value, at: Date.now() };
}

function opportunityFields(fd: FormData) {
  const travelers = opt(fd, "travelers");
  const priority = str(fd, "priority");
  return {
    ownerId: opt(fd, "ownerId"),
    source: opt(fd, "source"),
    destination: opt(fd, "destination"),
    product: opt(fd, "product"),
    travelStart: opt(fd, "travelStart"),
    travelEnd: opt(fd, "travelEnd"),
    dateFlexibility: opt(fd, "dateFlexibility"),
    travelers: travelers === null ? null : Number(travelers),
    budgetAmount: opt(fd, "budgetAmount"),
    budgetCurrency: opt(fd, "budgetAmount") ? opt(fd, "budgetCurrency") : null,
    priority: isPriority(priority) ? priority : undefined,
    notes: opt(fd, "notes"),
  };
}

export async function createOpportunityAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const contactId = str(fd, "contactId");
  const r = await run(() => withUser(db, user, (tx) => createOpportunity(tx, user.id, agencyId, { contactId, stageId: opt(fd, "stageId"), ...opportunityFields(fd) })));
  if (!r.ok) redirect(withParam(`/app/oportunidades/nueva?contactId=${encodeURIComponent(contactId)}`, "error", r.code));
  revalidatePath("/app/oportunidades");
  redirect(`/app/oportunidades/${r.value}?ok=creada`);
}

export async function updateOpportunityAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "opportunityId");
  const r = await run(() => withUser(db, user, (tx) => updateOpportunity(tx, user.id, agencyId, id, opportunityFields(fd))));
  if (!r.ok) redirect(withParam(`/app/oportunidades/${id}/editar`, "error", r.code));
  revalidatePath(`/app/oportunidades/${id}`);
  redirect(`/app/oportunidades/${id}?ok=guardada`);
}

export async function moveOpportunityAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "opportunityId");
  const reason = str(fd, "lostReason");
  const r = await run(() =>
    withUser(db, user, (tx) =>
      moveOpportunity(tx, user.id, agencyId, id, {
        stageId: str(fd, "stageId"),
        lostReason: isLossReason(reason) ? reason : null,
        lostNote: opt(fd, "lostNote"),
        wonEvidence: opt(fd, "wonEvidence"),
        reason: opt(fd, "reason"),
      }),
    ),
  );
  const to = back(fd, `/app/oportunidades/${id}`);
  if (!r.ok) redirect(withParam(to, "error", r.code));
  revalidatePath("/app/oportunidades");
  revalidatePath(`/app/oportunidades/${id}`);
  redirect(withParam(to, "ok", "etapa"));
}

export async function createTaskAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const to = back(fd, "/app");
  const kind = str(fd, "kind");
  const priority = str(fd, "priority");
  const dueAt = parseBogotaDateTime(str(fd, "dueAt"));
  if (!isTaskKind(kind) || !dueAt) redirect(withParam(to, "error", "invalid_input"));
  const r = await run(() =>
    withUser(db, user, (tx) =>
      createTask(tx, user.id, agencyId, {
        contactId: str(fd, "contactId"),
        opportunityId: opt(fd, "opportunityId"),
        kind,
        title: str(fd, "title"),
        assigneeId: opt(fd, "assigneeId"),
        dueAt,
        priority: isPriority(priority) ? priority : undefined,
      }),
    ),
  );
  if (!r.ok) redirect(withParam(to, "error", r.code));
  revalidatePath(to.split("?")[0]);
  redirect(withParam(to, "ok", "tarea"));
}

export async function completeTaskAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const to = back(fd, "/app");
  const r = await run(() => withUser(db, user, (tx) => completeTask(tx, user.id, agencyId, str(fd, "taskId"), str(fd, "result"))));
  if (!r.ok) redirect(withParam(to, "error", r.code));
  revalidatePath(to.split("?")[0]);
  redirect(withParam(to, "ok", "completada"));
}

export async function cancelTaskAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const to = back(fd, "/app");
  const r = await run(() => withUser(db, user, (tx) => cancelTask(tx, user.id, agencyId, str(fd, "taskId"), str(fd, "reason"))));
  if (!r.ok) redirect(withParam(to, "error", r.code));
  revalidatePath(to.split("?")[0]);
  redirect(withParam(to, "ok", "cancelada"));
}

export async function createStageAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const kind = str(fd, "kind");
  if (!isStageKind(kind)) redirect("/app/embudo?error=invalid_input");
  const r = await run(() => withUser(db, user, (tx) => createStage(tx, user.id, agencyId, { name: str(fd, "name"), kind })));
  if (!r.ok) redirect(`/app/embudo?error=${r.code}`);
  revalidatePath("/app/embudo");
  redirect("/app/embudo?ok=creada");
}

export async function updateStageAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const active = fd.get("active");
  const name = fd.get("name");
  const r = await run(() =>
    withUser(db, user, (tx) =>
      updateStage(tx, user.id, agencyId, str(fd, "stageId"), {
        name: name === null ? undefined : name.toString(),
        active: active === null ? undefined : active === "true",
      }),
    ),
  );
  if (!r.ok) redirect(`/app/embudo?error=${r.code}`);
  revalidatePath("/app/embudo");
  redirect("/app/embudo?ok=guardada");
}

/** Sube o baja una etapa un puesto. */
export async function moveStageAction(fd: FormData) {
  const { user, agencyId, db } = await ctx();
  const order = str(fd, "order").split(",").filter(Boolean);
  const id = str(fd, "stageId");
  const i = order.indexOf(id);
  const j = str(fd, "direction") === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) redirect("/app/embudo");
  [order[i], order[j]] = [order[j], order[i]];
  const r = await run(() => withUser(db, user, (tx) => reorderStages(tx, user.id, agencyId, order)));
  if (!r.ok) redirect(`/app/embudo?error=${r.code}`);
  revalidatePath("/app/embudo");
  redirect("/app/embudo");
}
