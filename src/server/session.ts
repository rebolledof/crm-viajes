import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb, withUser, type SessionUser } from "@/db/client";
import { createSupabaseServer } from "@/lib/supabase/server";
import { listMyMemberships, type MyMembership } from "./agencies";

export const ACTIVE_AGENCY_COOKIE = "crm_agencia";

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { id: user.id, email: user.email.toLowerCase() };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export type AppContext = { user: SessionUser; memberships: MyMembership[]; active: MyMembership | null };

/**
 * Usuario, sus agencias y la agencia activa. La cookie solo elige entre agencias donde la persona
 * tiene membresía vigente; un valor ajeno se ignora.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const user = await requireUser();
  const memberships = await withUser(getDb(), user, (tx) => listMyMemberships(tx, user.id));
  const chosen = (await cookies()).get(ACTIVE_AGENCY_COOKIE)?.value;
  const active = memberships.find((m) => m.agencyId === chosen) ?? memberships[0] ?? null;
  return { user, memberships, active };
});

export async function requireActiveAgency(): Promise<AppContext & { active: MyMembership }> {
  const ctx = await getAppContext();
  if (!ctx.active) redirect("/app/agencia/nueva");
  return ctx as AppContext & { active: MyMembership };
}
