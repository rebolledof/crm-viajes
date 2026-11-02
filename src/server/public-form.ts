// SPEC-003 · Formulario web público. Corre con el rol anon (withAnon): solo puede llamar a las
// funciones de entrada del esquema app, que sacan la agencia del código del formulario (RF-262).
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { WebFormData } from "@/domain/inbox";
import { AppError, rethrowBusiness } from "./errors";

/** Código del formulario: 32 caracteres hexadecimales. Cualquier otra cosa es "no existe". */
export function isFormKey(key: string): boolean {
  return /^[0-9a-f]{32}$/.test(key);
}

export type WebFormInfo = { agencyName: string; primary: string; accent: string; hasLogo: boolean; logoVersion: number; privacyUrl: string | null; active: boolean };

export async function webFormInfo(tx: Tx, key: string): Promise<WebFormInfo | null> {
  if (!isFormKey(key)) return null;
  const rows = await tx.execute<{ agency_name: string; primary_color: string; accent_color: string; has_logo: boolean; logo_version: string | number; privacy_url: string | null; active: boolean }>(
    sql`select * from app.web_form_info(${key})`,
  );
  const r = rows[0];
  if (!r) return null;
  return { agencyName: r.agency_name, primary: r.primary_color, accent: r.accent_color, hasLogo: r.has_logo, logoVersion: Number(r.logo_version), privacyUrl: r.privacy_url, active: r.active };
}

export async function webFormLogo(tx: Tx, key: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!isFormKey(key)) return null;
  const rows = await tx.execute<{ logo: Buffer; logo_type: string }>(sql`select * from app.web_form_logo(${key})`);
  return rows[0] ? { bytes: rows[0].logo, type: rows[0].logo_type } : null;
}

/** Huella de la dirección del visitante para el límite de envíos; no se guarda la dirección. */
export function rateKey(ip: string | null): string {
  return createHash("sha256").update(`crm-viajes:${ip ?? "desconocida"}`).digest("hex").slice(0, 32);
}

/** Recibe el formulario ya validado (parseWebForm). Devuelve la conversación creada. */
export async function submitWebForm(tx: Tx, key: string, data: WebFormData, ip: string | null): Promise<string> {
  if (!isFormKey(key)) throw new AppError("channel_closed");
  try {
    const rows = await tx.execute<{ id: string }>(sql`select app.submit_web_form(
      ${key}, ${rateKey(ip)}, ${data.name}, ${data.phone}, ${data.email},
      ${data.destination}, ${data.dates}, ${data.travelers}::integer, ${data.message}) as id`);
    return rows[0].id;
  } catch (err) {
    rethrowBusiness(err);
  }
}
