"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { AUTH_MESSAGES, signUpProblem } from "@/domain/auth-errors";
import { safeNext } from "@/lib/supabase/env";
import { createSupabaseServer } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8).max(72),
});

/** Conserva el correo (nunca la contraseña) y señala el campo con el problema. */
function failed(formData: FormData, code: string, field: "email" | "password" | "confirm"): FormState {
  const email = formData.get("email")?.toString() ?? "";
  return { error: AUTH_MESSAGES[code] ?? AUTH_MESSAGES.registro, field, values: { email: [email] }, at: Date.now() };
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const next = safeNext(formData.get("next")?.toString());
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return failed(formData, "datos", parsed.error.issues[0]?.path[0] === "email" ? "email" : "password");
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return error.code === "email_not_confirmed" ? failed(formData, "sin_confirmar", "email") : failed(formData, "credenciales", "password");
  redirect(next);
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const next = safeNext(formData.get("next")?.toString());
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return failed(formData, "datos", parsed.error.issues[0]?.path[0] === "email" ? "email" : "password");
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
    const problem = signUpProblem(error.code, error.status);
    return failed(formData, problem, problem === "clave_debil" ? "password" : "email");
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
export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.email().safeParse(formData.get("email")?.toString().trim().toLowerCase());
  if (!parsed.success) return { ...failed(formData, "datos", "email"), error: "Escribe un correo válido." };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=${encodeURIComponent("/app/clave")}`,
  });
  if (error) {
    console.error("resetPasswordForEmail falló", { code: error.code, status: error.status });
    if (signUpProblem(error.code, error.status) === "limite_correos") return failed(formData, "limite_correos", "email");
  }
  redirect("/recuperar?enviado=1");
}

/** Cambia la contraseña del usuario con sesión (llega aquí desde el enlace del correo). */
export async function updatePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = formData.get("password")?.toString() ?? "";
  if (password.length < 8 || password.length > 72) return { ...failed(formData, "datos", "password"), error: "La contraseña debe tener de 8 a 72 caracteres." };
  if (password !== formData.get("confirm")?.toString()) return failed(formData, "distintas", "confirm");
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("updateUser falló", { code: error.code, status: error.status });
    return failed(formData, error.code === "weak_password" ? "clave_debil" : error.code === "same_password" ? "igual" : "cambio", "password");
  }
  redirect("/app?ok=clave");
}
