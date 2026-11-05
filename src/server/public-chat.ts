// SPEC-003 parte 2 · Chat web público. Corre con el rol anon (withAnon): solo llama a las funciones
// del chat en el esquema app, que sacan la agencia del código del chat y validan la llave (RF-273).
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { isChatToken, type ChatStartData } from "@/domain/chat";
import { AppError, rethrowBusiness } from "./errors";
import { isFormKey, rateKey } from "./public-form";

export type ChatInfo = {
  agencyName: string;
  primary: string;
  accent: string;
  hasLogo: boolean;
  logoVersion: number;
  privacyUrl: string | null;
  active: boolean;
  openNow: boolean;
  /** Hora local de la agencia en que abre, como fecha "de pared" en UTC. */
  nextOpen: Date;
  /** Hora local actual de la agencia, igual que nextOpen. */
  localNow: Date;
};

export type ChatMessage = { id: string; direction: "entrante" | "saliente"; body: string; authorName: string | null; createdAt: string };

/** Llave nueva del visitante. La base solo recibe su huella (tokenHash). */
export function newChatToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(`crm-viajes-chat:${token}`).digest("hex");
}

export async function chatInfo(tx: Tx, key: string): Promise<ChatInfo | null> {
  if (!isFormKey(key)) return null;
  const rows = await tx.execute<{
    agency_name: string;
    primary_color: string;
    accent_color: string;
    has_logo: boolean;
    logo_version: string | number;
    privacy_url: string | null;
    active: boolean;
    open_now: boolean;
    next_open: string;
    local_now: string;
  }>(sql`select agency_name, primary_color, accent_color, has_logo, logo_version, privacy_url, active, open_now,
           to_char(next_open, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as next_open,
           to_char(local_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as local_now from app.chat_info(${key})`);
  const r = rows[0];
  if (!r) return null;
  return {
    agencyName: r.agency_name,
    primary: r.primary_color,
    accent: r.accent_color,
    hasLogo: r.has_logo,
    logoVersion: Number(r.logo_version),
    privacyUrl: r.privacy_url,
    active: r.active,
    openNow: r.open_now,
    nextOpen: new Date(r.next_open),
    localNow: new Date(r.local_now),
  };
}

/** Primer mensaje: crea la conversación y devuelve la llave que guarda el navegador del visitante. */
export async function startChat(tx: Tx, key: string, data: ChatStartData, ip: string | null): Promise<{ token: string; conversationId: string }> {
  if (!isFormKey(key)) throw new AppError("channel_closed");
  const token = newChatToken();
  try {
    const rows = await tx.execute<{ id: string }>(sql`select app.chat_start(
      ${key}, ${rateKey(ip)}, ${tokenHash(token)}, ${data.name}, ${data.phone}, ${data.email}, ${data.message}) as id`);
    return { token, conversationId: rows[0].id };
  } catch (err) {
    rethrowBusiness(err);
  }
}

export async function sendChat(tx: Tx, key: string, token: string, message: string): Promise<void> {
  if (!isFormKey(key)) throw new AppError("channel_closed");
  if (!isChatToken(token)) throw new AppError("not_found");
  try {
    await tx.execute(sql`select app.chat_send(${key}, ${tokenHash(token)}, ${message})`);
  } catch (err) {
    rethrowBusiness(err);
  }
}

/** Mensajes de la conversación del visitante; vacío si la llave no vale (AC-272, AC-280). */
export async function chatMessages(tx: Tx, key: string, token: string): Promise<ChatMessage[]> {
  if (!isFormKey(key) || !isChatToken(token)) return [];
  const rows = await tx.execute<{ id: string; direction: "entrante" | "saliente"; body: string; author_name: string | null; created_at: string | Date }>(
    sql`select * from app.chat_messages(${key}, ${tokenHash(token)})`,
  );
  return rows.map((r) => ({ id: r.id, direction: r.direction, body: r.body, authorName: r.author_name, createdAt: new Date(r.created_at).toISOString() }));
}
