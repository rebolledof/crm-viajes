"use server";

// Acciones de servidor de la bandeja (SPEC-003). La agencia sale de la sesión verificada; cada
// caso de uso valida permisos y la base aplica RLS.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { getDb, withUser } from "@/db/client";
import { isInboxFilter } from "@/domain/inbox";
import { AppError, CODE_FIELDS, errorMessage, type ErrorCode } from "@/server/errors";
import {
  assignConversation,
  createConversationOpportunity,
  createSavedReply,
  linkConversationOpportunity,
  deleteSavedReply,
  replyConversation,
  resolveConversation,
  takeConversation,
  updateInboxSettings,
  updateSavedReply,
  type ReplyVia,
} from "@/server/inbox";
import { requireActiveAgency } from "@/server/session";

const str = (fd: FormData, k: string) => fd.get(k)?.toString() ?? "";

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

function failed(fd: FormData, f: Failure): FormState {
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

/** Vuelve a la conversación con el filtro que tenía la lista. */
function inboxUrl(fd: FormData, id: string, extra?: string): string {
  const f = str(fd, "f");
  const params = new URLSearchParams();
  if (isInboxFilter(f)) params.set("f", f);
  params.set("c", id);
  if (extra) params.set("ok", extra);
  return `/app/bandeja?${params.toString()}`;
}

function errorUrl(fd: FormData, id: string, code: ErrorCode): string {
  return `${inboxUrl(fd, id)}&error=${code}`;
}

export async function takeConversationAction(fd: FormData): Promise<void> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "conversationId");
  const r = await run(() => withUser(db, user, (tx) => takeConversation(tx, user.id, agencyId, id)));
  revalidatePath("/app", "layout");
  redirect(r.ok ? inboxUrl(fd, id, "tomada") : errorUrl(fd, id, r.code));
}

export async function assignConversationAction(fd: FormData): Promise<void> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "conversationId");
  const to = str(fd, "assigneeId").trim() || null;
  const r = await run(() => withUser(db, user, (tx) => assignConversation(tx, user.id, agencyId, id, to)));
  revalidatePath("/app", "layout");
  redirect(r.ok ? inboxUrl(fd, id, "asignada") : errorUrl(fd, id, r.code));
}

export async function resolveConversationAction(fd: FormData): Promise<void> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "conversationId");
  const r = await run(() => withUser(db, user, (tx) => resolveConversation(tx, user.id, agencyId, id)));
  revalidatePath("/app", "layout");
  redirect(r.ok ? inboxUrl(fd, id, "resuelta") : errorUrl(fd, id, r.code));
}

export type ReplyState = { link?: string; via?: ReplyVia; sent?: boolean; error?: string; field?: string; body?: string; at?: number };

/**
 * Registra la respuesta. WhatsApp y correo devuelven el enlace que abre la app con el texto; el
 * chat no tiene enlace: el mensaje ya está en la ventana del visitante (RF-274).
 */
export async function replyAction(_prev: ReplyState, fd: FormData): Promise<ReplyState> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "conversationId");
  const rawVia = str(fd, "via");
  const via: ReplyVia = rawVia === "correo" ? "correo" : rawVia === "chat" ? "chat" : "whatsapp";
  const body = str(fd, "body");
  const r = await run(() => withUser(db, user, (tx) => replyConversation(tx, user.id, agencyId, id, { body, via })));
  if (!r.ok) return { error: errorMessage(r.code, r.field), field: r.field ?? "body", body, at: Date.now() };
  revalidatePath("/app", "layout");
  return { link: r.value.link ?? undefined, via, sent: true, at: Date.now() };
}

/** "Crear oportunidad" desde la conversación (RF-275). */
export async function createConversationOpportunityAction(fd: FormData): Promise<void> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "conversationId");
  const r = await run(() => withUser(db, user, (tx) => createConversationOpportunity(tx, user.id, agencyId, id)));
  revalidatePath("/app", "layout");
  redirect(r.ok ? inboxUrl(fd, id, "oportunidad_creada") : errorUrl(fd, id, r.code));
}

/** "Vincular a una oportunidad" abierta del mismo contacto (RF-275). */
export async function linkConversationOpportunityAction(fd: FormData): Promise<void> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "conversationId");
  const oppId = str(fd, "opportunityId");
  const r = await run(() => withUser(db, user, (tx) => linkConversationOpportunity(tx, user.id, agencyId, id, oppId)));
  revalidatePath("/app", "layout");
  redirect(r.ok ? inboxUrl(fd, id, "oportunidad_vinculada") : errorUrl(fd, id, r.code));
}

// Respuestas guardadas.

function replyInput(fd: FormData) {
  return { title: str(fd, "replyTitle"), shortcut: str(fd, "shortcut"), body: str(fd, "replyBody") };
}

export async function createSavedReplyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const personal = str(fd, "scope") !== "agencia";
  const r = await run(() => withUser(db, user, (tx) => createSavedReply(tx, user.id, agencyId, { ...replyInput(fd), personal })));
  if (!r.ok) return failed(fd, r);
  revalidatePath("/app/bandeja/respuestas");
  redirect("/app/bandeja/respuestas?ok=respuesta_creada");
}

export async function updateSavedReplyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "replyId");
  const r = await run(() => withUser(db, user, (tx) => updateSavedReply(tx, user.id, agencyId, id, replyInput(fd))));
  if (!r.ok) return failed(fd, r);
  revalidatePath("/app/bandeja/respuestas");
  redirect("/app/bandeja/respuestas?ok=respuesta_guardada");
}

export async function deleteSavedReplyAction(fd: FormData): Promise<void> {
  const { user, agencyId, db } = await ctx();
  const r = await run(() => withUser(db, user, (tx) => deleteSavedReply(tx, user.id, agencyId, str(fd, "replyId"))));
  revalidatePath("/app/bandeja/respuestas");
  redirect(r.ok ? "/app/bandeja/respuestas?ok=respuesta_borrada" : `/app/bandeja/respuestas?error=${r.code}`);
}

// Configuración › Canales.

export async function updateInboxSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const raw = str(fd, "maxMinutes").trim();
  const maxMinutes = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  const r = await run(() =>
    withUser(db, user, (tx) =>
      updateInboxSettings(tx, user.id, agencyId, {
        maxMinutes,
        privacyUrl: str(fd, "privacyUrl"),
        formActive: str(fd, "formActive") === "on",
        // Solo cambia el chat si la pantalla mandó su casilla.
        chatActive: fd.has("chatActiveSent") ? str(fd, "chatActive") === "on" : undefined,
      }),
    ),
  );
  if (!r.ok) return failed(fd, r);
  revalidatePath("/app/configuracion/canales");
  redirect("/app/configuracion/canales?ok=ajustes");
}
