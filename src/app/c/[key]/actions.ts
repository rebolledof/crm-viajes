"use server";

// Chat web público (SPEC-003 parte 2). Sin sesión: corre con el rol anon y la agencia sale del
// código del chat. La llave del visitante la crea el servidor; la base solo guarda su huella.
import { headers } from "next/headers";
import type { FormState } from "@/components/form";
import { getDb, withAnon } from "@/db/client";
import { parseChatMessage, parseChatStart } from "@/domain/chat";
import { AppError } from "@/server/errors";
import { chatMessages, sendChat, startChat, type ChatMessage } from "@/server/public-chat";
import { isFormKey } from "@/server/public-form";

const str = (fd: FormData, k: string) => fd.get(k)?.toString() ?? "";

/** token: llave nueva del visitante. received: el campo trampa se llenó; se dice "recibido" sin guardar nada. */
export type ChatStartState = FormState & { token?: string; received?: boolean };

const CHAT_ERRORS = {
  channel_closed: "Este chat no está recibiendo mensajes ahora. Escríbele a la agencia por WhatsApp o por correo.",
  rate_limited: "Recibimos muchos mensajes seguidos. Espera unos minutos y vuelve a intentarlo; lo que escribiste se conserva.",
  not_found: "Esta conversación ya no está disponible. Escribe de nuevo para empezar otra.",
  failed: "No pudimos enviar tu mensaje. Revisa tu conexión e inténtalo de nuevo; lo que escribiste se conserva.",
} as const;

function keep(fd: FormData, error: string, field?: string): ChatStartState {
  const values: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$") || typeof v !== "string") continue;
    (values[k] ??= []).push(v);
  }
  return { error, field, values, at: Date.now() };
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** Primer mensaje (RF-272). Devuelve la llave que guarda el navegador del visitante. */
export async function startChatAction(_prev: ChatStartState, fd: FormData): Promise<ChatStartState> {
  const key = str(fd, "key");
  if (!isFormKey(key)) return keep(fd, CHAT_ERRORS.channel_closed);
  // Campo trampa: el robot cree que todo salió bien, pero no se guarda nada.
  if (str(fd, "hp_contacto").trim()) {
    console.warn("chat web: mensaje descartado por el campo trampa", { key: key.slice(0, 8) });
    return { at: Date.now(), received: true };
  }
  const parsed = parseChatStart({ name: str(fd, "name"), phone: str(fd, "phone"), email: str(fd, "email"), message: str(fd, "message"), privacy: str(fd, "privacy") === "on" });
  if (!parsed.ok) return keep(fd, parsed.error.message, parsed.error.field);
  const ip = await clientIp();
  try {
    const r = await withAnon(getDb(), (tx) => startChat(tx, key, parsed.data, ip));
    return { at: Date.now(), token: r.token };
  } catch (err) {
    if (err instanceof AppError && (err.code === "channel_closed" || err.code === "rate_limited")) return keep(fd, CHAT_ERRORS[err.code]);
    if (err instanceof AppError && err.code === "invalid_input") return keep(fd, "Revisa tus datos y el mensaje.");
    console.error(err);
    return keep(fd, CHAT_ERRORS.failed);
  }
}

export type SendResult = { ok: true } | { ok: false; error: string; expired?: boolean };

/** Mensajes siguientes (RF-276). */
export async function sendChatAction(key: string, token: string, body: string): Promise<SendResult> {
  const msg = parseChatMessage(body);
  if (!msg.ok) return { ok: false, error: msg.message };
  try {
    await withAnon(getDb(), (tx) => sendChat(tx, key, token, msg.text));
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError && (err.code === "channel_closed" || err.code === "rate_limited")) return { ok: false, error: CHAT_ERRORS[err.code] };
    if (err instanceof AppError && err.code === "not_found") return { ok: false, error: CHAT_ERRORS.not_found, expired: true };
    if (err instanceof AppError && err.code === "invalid_input") return { ok: false, error: "Revisa el mensaje." };
    console.error(err);
    return { ok: false, error: CHAT_ERRORS.failed };
  }
}

/** Mensajes de la conversación del visitante; vacío si la llave no vale. */
export async function loadChatAction(key: string, token: string): Promise<ChatMessage[]> {
  return withAnon(getDb(), (tx) => chatMessages(tx, key, token));
}
