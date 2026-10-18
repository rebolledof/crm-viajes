"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, withUser } from "@/db/client";
import { ROLES } from "@/domain/permissions";
import {
  acceptInvitation,
  changeMemberRole,
  createAgency,
  createInvitation,
  renameAgency,
  revokeInvitation,
  revokeMembership,
} from "@/server/agencies";
import { AppError, ERROR_MESSAGES, type ErrorCode } from "@/server/errors";
import { ACTIVE_AGENCY_COOKIE, getAppContext, requireActiveAgency, requireUser } from "@/server/session";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

/** Ejecuta un caso de uso y devuelve el código de error de negocio, o null si salió bien. */
async function attempt(fn: () => Promise<unknown>): Promise<ErrorCode | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    console.error(err);
    throw err;
  }
}

function fail(path: string, code: ErrorCode): never {
  redirect(`${path}?error=${code}`);
}

export async function createAgencyAction(formData: FormData) {
  const user = await requireUser();
  const name = z.string().trim().safeParse(formData.get("name"));
  if (!name.success) fail("/app/agencia/nueva", "invalid_input");
  let agencyId = "";
  const err = await attempt(async () => {
    agencyId = await withUser(getDb(), user, (tx) => createAgency(tx, name.data));
  });
  if (err) fail("/app/agencia/nueva", err);
  (await cookies()).set(ACTIVE_AGENCY_COOKIE, agencyId, COOKIE_OPTS);
  redirect("/app");
}

export async function switchAgencyAction(formData: FormData) {
  const { memberships } = await getAppContext();
  const id = formData.get("agencyId")?.toString();
  if (!memberships.some((m) => m.agencyId === id)) fail("/app", "not_found");
  (await cookies()).set(ACTIVE_AGENCY_COOKIE, id!, COOKIE_OPTS);
  redirect("/app");
}

export async function renameAgencyAction(formData: FormData) {
  const { user, active } = await requireActiveAgency();
  const name = formData.get("name")?.toString() ?? "";
  const err = await attempt(() => withUser(getDb(), user, (tx) => renameAgency(tx, user.id, active.agencyId, name)));
  if (err) fail("/app", err);
  revalidatePath("/app", "layout");
  redirect("/app?ok=agencia");
}

const inviteSchema = z.object({ email: z.email(), role: z.enum(ROLES) });

export type InviteState = { link?: string; email?: string; error?: string };

export async function inviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const { user, active } = await requireActiveAgency();
  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: ERROR_MESSAGES.invalid_input };
  let token = "";
  const err = await attempt(async () => {
    ({ token } = await withUser(getDb(), user, (tx) =>
      createInvitation(tx, { userId: user.id, agencyId: active.agencyId, email: parsed.data.email, role: parsed.data.role, now: new Date() }),
    ));
  });
  if (err) return { error: ERROR_MESSAGES[err] };
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  revalidatePath("/app/equipo");
  return { link: `${origin}/invitacion/${token}`, email: parsed.data.email.toLowerCase() };
}

export async function revokeInvitationAction(formData: FormData) {
  const { user, active } = await requireActiveAgency();
  const id = z.uuid().safeParse(formData.get("invitationId"));
  if (!id.success) fail("/app/equipo", "invalid_input");
  const err = await attempt(() => withUser(getDb(), user, (tx) => revokeInvitation(tx, user.id, active.agencyId, id.data)));
  if (err) fail("/app/equipo", err);
  revalidatePath("/app/equipo");
}

export async function changeRoleAction(formData: FormData) {
  const { user, active } = await requireActiveAgency();
  const parsed = z.object({ memberId: z.uuid(), role: z.enum(ROLES) }).safeParse({ memberId: formData.get("memberId"), role: formData.get("role") });
  if (!parsed.success) fail("/app/equipo", "invalid_input");
  const err = await attempt(() => withUser(getDb(), user, (tx) => changeMemberRole(tx, user.id, active.agencyId, parsed.data.memberId, parsed.data.role)));
  if (err) fail("/app/equipo", err);
  revalidatePath("/app/equipo");
}

export async function revokeMemberAction(formData: FormData) {
  const { user, active } = await requireActiveAgency();
  const id = z.uuid().safeParse(formData.get("memberId"));
  if (!id.success) fail("/app/equipo", "invalid_input");
  const err = await attempt(() => withUser(getDb(), user, (tx) => revokeMembership(tx, user.id, active.agencyId, id.data)));
  if (err) fail("/app/equipo", err);
  revalidatePath("/app/equipo");
}

export async function acceptInvitationAction(formData: FormData) {
  const user = await requireUser();
  const token = formData.get("token")?.toString() ?? "";
  let agencyId = "";
  const err = await attempt(async () => {
    agencyId = await withUser(getDb(), user, (tx) => acceptInvitation(tx, token));
  });
  if (err) redirect(`/invitacion/${encodeURIComponent(token)}?error=${err}`);
  (await cookies()).set(ACTIVE_AGENCY_COOKIE, agencyId, COOKIE_OPTS);
  redirect("/app");
}
