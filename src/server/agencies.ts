// Casos de uso de agencias, equipo e invitaciones. Reciben una transacción abierta con withUser,
// así que RLS se aplica siempre; además validan permisos aquí para devolver errores claros.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { agencies, auditEvents, invitations, memberships } from "@/db/schema";
import { isValidAgencyName, slugify } from "@/domain/agency";
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
  normalizeEmail,
} from "@/domain/invitations";
import { can, type Permission, type Role } from "@/domain/permissions";
import { AppError, pgError } from "./errors";

export type MyMembership = { agencyId: string; agencyName: string; role: Role };

export async function listMyMemberships(tx: Tx, userId: string): Promise<MyMembership[]> {
  return tx
    .select({ agencyId: agencies.id, agencyName: agencies.name, role: memberships.role })
    .from(memberships)
    .innerJoin(agencies, eq(agencies.id, memberships.agencyId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.revokedAt)))
    .orderBy(agencies.name);
}

export async function requirePermission(tx: Tx, userId: string, agencyId: string, permission: Permission): Promise<Role> {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.agencyId, agencyId), eq(memberships.userId, userId), isNull(memberships.revokedAt)));
  if (!row) throw new AppError("not_found");
  if (!can(row.role, permission)) throw new AppError("permission_denied");
  return row.role;
}

export async function recordAudit(
  tx: Tx,
  e: { agencyId: string; actorId: string; action: string; objectType: string; objectId?: string; changes?: Record<string, unknown>; reason?: string },
): Promise<void> {
  await tx.insert(auditEvents).values({
    agencyId: e.agencyId,
    actorId: e.actorId,
    action: e.action,
    objectType: e.objectType,
    objectId: e.objectId,
    changes: e.changes ?? {},
    reason: e.reason,
  });
}

export async function createAgency(tx: Tx, name: string): Promise<string> {
  if (!isValidAgencyName(name)) throw new AppError("invalid_input");
  const slug = slugify(name);
  if (!slug) throw new AppError("invalid_input");
  try {
    const rows = await tx.execute<{ id: string }>(sql`select public.create_agency(${name}, ${slug}) as id`);
    return rows[0].id;
  } catch (err) {
    if (pgCode(err) === "23505") throw new AppError("slug_taken");
    throw err;
  }
}

export async function renameAgency(tx: Tx, userId: string, agencyId: string, name: string): Promise<void> {
  await requirePermission(tx, userId, agencyId, "agency.update");
  if (!isValidAgencyName(name)) throw new AppError("invalid_input");
  const updated = await tx.update(agencies).set({ name: name.trim() }).where(eq(agencies.id, agencyId)).returning({ id: agencies.id });
  if (!updated.length) throw new AppError("not_found");
  await recordAudit(tx, { agencyId, actorId: userId, action: "agency.renamed", objectType: "agency", objectId: agencyId, changes: { name: name.trim() } });
}

export async function listMembers(tx: Tx, agencyId: string) {
  return tx
    .select({ userId: memberships.userId, email: memberships.email, role: memberships.role, revokedAt: memberships.revokedAt, createdAt: memberships.createdAt })
    .from(memberships)
    .where(eq(memberships.agencyId, agencyId))
    .orderBy(memberships.createdAt);
}

export async function listInvitations(tx: Tx, agencyId: string) {
  return tx
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(eq(invitations.agencyId, agencyId))
    .orderBy(desc(invitations.createdAt));
}

/** Crea la invitación y devuelve el token en claro. Solo se muestra una vez; la base guarda el hash. */
export async function createInvitation(
  tx: Tx,
  input: { userId: string; agencyId: string; email: string; role: Role; now: Date },
): Promise<{ id: string; token: string }> {
  await requirePermission(tx, input.userId, input.agencyId, "team.manage");
  const email = normalizeEmail(input.email);
  const token = generateInvitationToken();
  const [row] = await tx
    .insert(invitations)
    .values({
      agencyId: input.agencyId,
      email,
      role: input.role,
      tokenHash: hashInvitationToken(token),
      expiresAt: invitationExpiresAt(input.now),
      invitedBy: input.userId,
    })
    .returning({ id: invitations.id });
  await recordAudit(tx, { agencyId: input.agencyId, actorId: input.userId, action: "invitation.created", objectType: "invitation", objectId: row.id, changes: { email, role: input.role } });
  return { id: row.id, token };
}

export async function revokeInvitation(tx: Tx, userId: string, agencyId: string, invitationId: string): Promise<void> {
  await requirePermission(tx, userId, agencyId, "team.manage");
  const updated = await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), eq(invitations.agencyId, agencyId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .returning({ id: invitations.id });
  if (!updated.length) throw new AppError("not_found");
  await recordAudit(tx, { agencyId, actorId: userId, action: "invitation.revoked", objectType: "invitation", objectId: invitationId });
}

export async function changeMemberRole(tx: Tx, userId: string, agencyId: string, memberId: string, role: Role): Promise<void> {
  await requirePermission(tx, userId, agencyId, "team.manage");
  if (memberId === userId) throw new AppError("permission_denied");
  const updated = await tx
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.agencyId, agencyId), eq(memberships.userId, memberId), isNull(memberships.revokedAt)))
    .returning({ userId: memberships.userId });
  if (!updated.length) throw new AppError("not_found");
  await recordAudit(tx, { agencyId, actorId: userId, action: "membership.role_changed", objectType: "membership", objectId: memberId, changes: { role } });
}

export async function revokeMembership(tx: Tx, userId: string, agencyId: string, memberId: string): Promise<void> {
  await requirePermission(tx, userId, agencyId, "team.manage");
  if (memberId === userId) throw new AppError("permission_denied");
  const updated = await tx
    .update(memberships)
    .set({ revokedAt: new Date() })
    .where(and(eq(memberships.agencyId, agencyId), eq(memberships.userId, memberId), isNull(memberships.revokedAt)))
    .returning({ userId: memberships.userId });
  if (!updated.length) throw new AppError("not_found");
  await recordAudit(tx, { agencyId, actorId: userId, action: "membership.revoked", objectType: "membership", objectId: memberId });
}

export async function acceptInvitation(tx: Tx, token: string): Promise<string> {
  try {
    const rows = await tx.execute<{ agency_id: string }>(sql`select public.accept_invitation(${token}) as agency_id`);
    return rows[0].agency_id;
  } catch (err) {
    if (pgMessage(err) === "invitation_invalid") throw new AppError("invitation_invalid");
    if (pgMessage(err) === "not_authenticated") throw new AppError("not_authenticated");
    throw err;
  }
}

export async function listAudit(tx: Tx, userId: string, agencyId: string, limit = 50) {
  await requirePermission(tx, userId, agencyId, "audit.read");
  return tx
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.agencyId, agencyId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}

function pgCode(err: unknown) {
  return pgError(err)?.code;
}
function pgMessage(err: unknown) {
  return pgError(err)?.message;
}
