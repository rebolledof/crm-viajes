"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
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
  if (error) back("/login", "credenciales", next);
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
  if (error) back("/registro", "registro", next);
  if (!data.session) redirect(`/login?aviso=confirma&next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function signOutAction() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
