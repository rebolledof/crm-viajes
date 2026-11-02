"use server";

// SPEC-002c · Acciones de la marca de la agencia y de las preferencias personales. La agencia y la
// persona salen de la sesión verificada; nada del formulario decide a quién se le aplica.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { getDb, withUser } from "@/db/client";
import { contrastWarning, normalizeHex } from "@/domain/branding";
import { backPathFrom } from "@/domain/preferences";
import { setPreferences, updateBranding } from "@/server/branding";
import { AppError, CODE_FIELDS, errorMessage } from "@/server/errors";
import { requireActiveAgency, requireUser } from "@/server/session";

function keepValues(fd: FormData): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$") || typeof v !== "string") continue;
    (values[k] ??= []).push(v);
  }
  return values;
}

export async function updateBrandingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, active } = await requireActiveAgency();
  const file = fd.get("logo");
  const remove = fd.get("removeLogo") === "1";
  let logo: Uint8Array | "quitar" | undefined;
  if (remove) logo = "quitar";
  else if (file instanceof File && file.size > 0) logo = new Uint8Array(await file.arrayBuffer());
  const primary = fd.get("primary")?.toString() ?? "";
  const accent = fd.get("accent")?.toString() ?? "";
  try {
    await withUser(getDb(), user, (tx) => updateBranding(tx, user.id, active.agencyId, { primary, accent, logo }));
  } catch (err) {
    if (err instanceof AppError) {
      const field = err.field ?? CODE_FIELDS[err.code];
      return { error: errorMessage(err.code, field), field, values: keepValues(fd), at: Date.now() };
    }
    console.error(err);
    throw err;
  }
  revalidatePath("/app", "layout");
  const warn = contrastWarning(normalizeHex(primary) ?? "");
  redirect(`/app/configuracion/marca?ok=marca${warn ? `&contraste=${encodeURIComponent(warn.suggestion)}` : ""}`);
}

/** Pantalla interna desde la que se cambió la preferencia, para volver a ella. */
async function backPath(): Promise<string> {
  const h = await headers();
  return backPathFrom(h.get("referer"), h.get("x-forwarded-host") ?? h.get("host"));
}

/** Cambia una preferencia personal (RF-243): menú arriba o a la izquierda, comprimido, tema. */
export async function setPreferenceAction(fd: FormData) {
  const user = await requireUser();
  const input: Record<string, unknown> = {};
  const layout = fd.get("navLayout");
  const collapsed = fd.get("navCollapsed");
  const theme = fd.get("theme");
  if (layout !== null) input.navLayout = layout.toString();
  if (collapsed !== null) input.navCollapsed = collapsed.toString() === "true";
  if (theme !== null) input.theme = theme.toString();
  try {
    await withUser(getDb(), user, (tx) => setPreferences(tx, user.id, input));
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
  }
  revalidatePath("/app", "layout");
  redirect(await backPath());
}
