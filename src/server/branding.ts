// SPEC-002c · Marca de la agencia y preferencias personales.
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { agencyBranding, userPreferences } from "@/db/schema";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, LOGO_MAX_BYTES, normalizeHex, sniffLogoType, type LogoType } from "@/domain/branding";
import { isNavLayout, isTheme, toPreferences, type Preferences } from "@/domain/preferences";
import { recordAudit, requirePermission } from "./agencies";
import { AppError, fieldError, rethrowBusiness } from "./errors";

export type Branding = { primary: string; accent: string; hasLogo: boolean; version: number };

/** Marca de la agencia activa (RF-241). Sin fila guardada, los colores por defecto. */
export async function getBranding(tx: Tx, userId: string, agencyId: string): Promise<Branding> {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const [row] = await tx
    .select({ primary: agencyBranding.primaryColor, accent: agencyBranding.accentColor, hasLogo: sql<boolean>`${agencyBranding.logo} is not null`, updatedAt: agencyBranding.updatedAt })
    .from(agencyBranding)
    .where(eq(agencyBranding.agencyId, agencyId));
  if (!row) return { primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT, hasLogo: false, version: 0 };
  return { primary: row.primary, accent: row.accent, hasLogo: row.hasLogo, version: row.updatedAt.getTime() };
}

export async function getLogo(tx: Tx, userId: string, agencyId: string): Promise<{ bytes: Buffer; type: LogoType } | null> {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const [row] = await tx.select({ logo: agencyBranding.logo, type: agencyBranding.logoType }).from(agencyBranding).where(eq(agencyBranding.agencyId, agencyId));
  if (!row?.logo || !row.type) return null;
  return { bytes: row.logo, type: row.type as LogoType };
}

export type BrandingInput = {
  primary: string;
  accent: string;
  /** Archivo nuevo, "quitar" para borrar el logo, o undefined para dejarlo como está. */
  logo?: Uint8Array | "quitar";
};

/** Guardar la marca (RF-240, RF-242, RF-248). Solo administrador; queda en auditoría. */
export async function updateBranding(tx: Tx, userId: string, agencyId: string, input: BrandingInput): Promise<void> {
  await requirePermission(tx, userId, agencyId, "agency.update");
  const primary = normalizeHex(input.primary);
  if (!primary) throw fieldError("invalid_color", "primary");
  const accent = normalizeHex(input.accent);
  if (!accent) throw fieldError("invalid_color", "accent");
  let logo: { bytes: Buffer | null; type: LogoType | null } | undefined;
  if (input.logo === "quitar") logo = { bytes: null, type: null };
  else if (input.logo && input.logo.length > 0) {
    if (input.logo.length > LOGO_MAX_BYTES) throw fieldError("logo_too_big", "logo");
    const type = sniffLogoType(input.logo);
    if (!type) throw fieldError("logo_type", "logo");
    logo = { bytes: Buffer.from(input.logo), type };
  }
  const [before] = await tx.select({ primary: agencyBranding.primaryColor, accent: agencyBranding.accentColor }).from(agencyBranding).where(eq(agencyBranding.agencyId, agencyId));
  const now = new Date();
  const values = { primaryColor: primary, accentColor: accent, updatedBy: userId, updatedAt: now, ...(logo ? { logo: logo.bytes, logoType: logo.type } : {}) };
  try {
    await tx
      .insert(agencyBranding)
      .values({ agencyId, ...values })
      .onConflictDoUpdate({ target: agencyBranding.agencyId, set: values });
  } catch (err) {
    rethrowBusiness(err);
  }
  const changes: Record<string, unknown> = {};
  if ((before?.primary ?? DEFAULT_PRIMARY) !== primary) changes.primaryColor = { de: before?.primary ?? DEFAULT_PRIMARY, a: primary };
  if ((before?.accent ?? DEFAULT_ACCENT) !== accent) changes.accentColor = { de: before?.accent ?? DEFAULT_ACCENT, a: accent };
  if (logo) changes.logo = logo.bytes ? "cambiado" : "quitado";
  if (Object.keys(changes).length) await recordAudit(tx, { agencyId, actorId: userId, action: "branding.updated", objectType: "agency", objectId: agencyId, changes });
}

/** Preferencias de la persona (RF-243). Sin fila, los valores por defecto (RF-244). */
export async function getPreferences(tx: Tx, userId: string): Promise<Preferences> {
  const [row] = await tx.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return toPreferences(row);
}

export async function setPreferences(tx: Tx, userId: string, input: Partial<Record<keyof Preferences, unknown>>): Promise<Preferences> {
  const current = await getPreferences(tx, userId);
  const next: Preferences = { ...current };
  if (input.navLayout !== undefined) {
    if (!isNavLayout(input.navLayout)) throw new AppError("invalid_input");
    next.navLayout = input.navLayout;
  }
  if (input.navCollapsed !== undefined) {
    if (typeof input.navCollapsed !== "boolean") throw new AppError("invalid_input");
    next.navCollapsed = input.navCollapsed;
  }
  if (input.theme !== undefined) {
    if (!isTheme(input.theme)) throw new AppError("invalid_input");
    next.theme = input.theme;
  }
  const values = { ...next, updatedAt: new Date() };
  await tx.insert(userPreferences).values({ userId, ...values }).onConflictDoUpdate({ target: userPreferences.userId, set: values });
  return next;
}
