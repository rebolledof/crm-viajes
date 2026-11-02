"use server";

// Envío del formulario web público (SPEC-003). Sin sesión: corre con el rol anon y la agencia sale
// del código del formulario. El campo trampa ("sitio") lo llenan robots, no personas.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { getDb, withAnon } from "@/db/client";
import { parseWebForm } from "@/domain/inbox";
import { AppError, ERROR_MESSAGES } from "@/server/errors";
import { isFormKey, submitWebForm } from "@/server/public-form";

const str = (fd: FormData, k: string) => fd.get(k)?.toString() ?? "";

function keep(fd: FormData, error: string, field?: string): FormState {
  const values: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$") || typeof v !== "string") continue;
    (values[k] ??= []).push(v);
  }
  return { error, field, values, at: Date.now() };
}

export async function submitWebFormAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const key = str(fd, "key");
  if (!isFormKey(key)) return keep(fd, ERROR_MESSAGES.channel_closed);
  const done = `/f/${key}?enviado=1${str(fd, "embed") === "1" ? "&embed=1" : ""}`;
  // Campo trampa: se responde como si todo saliera bien, pero no se guarda nada.
  if (str(fd, "sitio").trim()) redirect(done);
  const parsed = parseWebForm({
    name: str(fd, "name"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    destination: str(fd, "destination"),
    dates: str(fd, "dates"),
    travelers: str(fd, "travelers"),
    message: str(fd, "message"),
    privacy: str(fd, "privacy") === "on",
  });
  if (!parsed.ok) return keep(fd, parsed.error.message, parsed.error.field === "contacto" ? "phone" : parsed.error.field);
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    await withAnon(getDb(), (tx) => submitWebForm(tx, key, parsed.data, ip));
  } catch (err) {
    if (err instanceof AppError && (err.code === "channel_closed" || err.code === "rate_limited")) return keep(fd, ERROR_MESSAGES[err.code]);
    if (err instanceof AppError && err.code === "invalid_input") return keep(fd, "Revisa los datos del formulario.");
    console.error(err);
    return keep(fd, "No pudimos enviar tu consulta. Inténtalo de nuevo en un momento; lo que escribiste se conserva.");
  }
  redirect(done);
}
