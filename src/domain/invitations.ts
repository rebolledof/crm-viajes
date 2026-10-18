import { createHash, randomBytes } from "node:crypto";

/** Vigencia de una invitación (SPEC-000 AC-08). */
export const INVITATION_TTL_DAYS = 7;

export function invitationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Token opaco que solo viaja en el enlace; en la base se guarda su hash. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Debe coincidir con encode(sha256(convert_to(token, 'UTF8')), 'hex') de accept_invitation. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type InvitationStatus = "pendiente" | "aceptada" | "revocada" | "vencida";

export function invitationStatus(
  inv: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date,
): InvitationStatus {
  if (inv.revokedAt) return "revocada";
  if (inv.acceptedAt) return "aceptada";
  if (inv.expiresAt.getTime() <= now.getTime()) return "vencida";
  return "pendiente";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
