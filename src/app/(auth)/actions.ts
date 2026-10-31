"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signUpProblem } from "@/domain/auth-errors";
import { safeNext } from "@/lib/supabase/env";
import { createSupabaseServer } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8).max(72),
});

function back(path: string, error: string, next?: string): never {
  const q = new URLSearchParams({ error });
  if (next) q.set("next", next);
  redirect(`${path}?${q}`);
}

export async function signInAction(formData: FormData) {
  const next = safeNext(formData.get("next")?.toString());
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) back("/login", "datos", next);
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) back("/login", error.code === "email_not_confirmed" ? "sin_confirmar" : "credenciales", next);
  redirect(next);
}

export async function signUpAction(formData: FormData) {
  const next = safeNext(formData.get("next")?.toString());
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) back("/registro", "datos", next);
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    // Solo el código y el estado: nunca el correo ni la contraseña en los logs.
    console.error("signUp falló", { code: error.code, status: error.status });
    back("/registro", signUpProblem(error.code, error.status), next);
  }
  if (!data.session) redirect(`/login?aviso=confirma&next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function signOutAction() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/** Envía el enlace para elegir una contraseña nueva. Responde igual exista o no la cuenta. */
export async function requestPasswordResetAction(formData: FormData) {
  const parsed = z.email().safeParse(formData.get("email")?.toString().trim().toLowerCase());
  if (!parsed.success) redirect("/recuperar?error=datos");
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=${encodeURIComponent("/app/clave")}`,
  });
  if (error) {
    console.error("resetPasswordForEmail falló", { code: error.code, status: error.status });
    if (signUpProblem(error.code, error.status) === "limite_correos") redirect("/recuperar?error=limite_correos");
  }
  redirect("/recuperar?enviado=1");
}

/** Cambia la contraseña del usuario con sesión (llega aquí desde el enlace del correo). */
export async function updatePasswordAction(formData: FormData) {
  const password = formData.get("password")?.toString() ?? "";
  if (password.length < 8 || password.length > 72) redirect("/app/clave?error=datos");
  if (password !== formData.get("confirm")?.toString()) redirect("/app/clave?error=distintas");
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("updateUser falló", { code: error.code, status: error.status });
    redirect(`/app/clave?error=${error.code === "weak_password" ? "clave_debil" : error.code === "same_password" ? "igual" : "cambio"}`);
  }
  redirect("/app?ok=clave");
}
