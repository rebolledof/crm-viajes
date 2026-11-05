"use server";

// Acciones de servidor del cotizador (SPEC-004 parte 2). La agencia sale de la sesión verificada;
// los permisos los revisan los casos de uso y la base (RLS y triggers).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { getDb, withUser } from "@/db/client";
import { AppError, CODE_FIELDS, errorMessage, type ErrorCode } from "@/server/errors";
import { createNextVersion, createQuote, saveCatalogService, saveDraftPart, updateQuoteSettings, type DraftItemInput, type DraftPart } from "@/server/quotes";
import { requireActiveAgency } from "@/server/session";

const str = (fd: FormData, k: string) => fd.get(k)?.toString() ?? "";
const all = (fd: FormData, k: string) => fd.getAll(k).map((v) => v.toString());

type Failure = { ok: false; code: ErrorCode; field?: string };

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | Failure> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, field: err.field ?? CODE_FIELDS[err.code] };
    console.error(err);
    throw err;
  }
}

/** Conserva todo lo escrito y señala el campo con el problema (regla de usabilidad). */
function failed(fd: FormData, f: Pick<Failure, "code" | "field">): FormState {
  const values: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$") || typeof v !== "string") continue;
    (values[k] ??= []).push(v);
  }
  // En un servicio de la lista se dice cuál: "Servicio 2: escribe qué servicio es…".
  const n = /^[a-zA-Z]+\.(\d+)$/.exec(f.field ?? "")?.[1];
  const message = errorMessage(f.code, f.field);
  return { error: n ? `Servicio ${Number(n) + 1}: ${message.charAt(0).toLowerCase()}${message.slice(1)}` : message, field: f.field, values, at: Date.now() };
}

async function ctx() {
  const { user, active } = await requireActiveAgency();
  return { user, agencyId: active.agencyId, db: getDb() };
}

const quotePath = (versionId: string) => `/app/cotizaciones/${versionId}`;

/** "Nueva cotización" desde la ficha de la oportunidad (alcance 1). */
export async function createQuoteAction(fd: FormData): Promise<void> {
  const { user, agencyId, db } = await ctx();
  const opportunityId = str(fd, "opportunityId");
  const r = await run(() => withUser(db, user, (tx) => createQuote(tx, user.id, agencyId, { opportunityId, now: new Date() })));
  if (!r.ok) redirect(`/app/oportunidades/${encodeURIComponent(opportunityId)}?error=${r.code}`);
  revalidatePath(`/app/oportunidades/${opportunityId}`);
  redirect(`${quotePath(r.value.versionId)}?ok=cotizacion_creada`);
}

/** "Crear versión N" desde cualquier versión; si ya hay borrador, abre ese (AC-414). */
export async function createNextVersionAction(fd: FormData): Promise<void> {
  const { user, agencyId, db } = await ctx();
  const fromId = str(fd, "versionId");
  const r = await run(() => withUser(db, user, (tx) => createNextVersion(tx, user.id, agencyId, fromId)));
  if (!r.ok) redirect(`${quotePath(encodeURIComponent(fromId))}?error=${r.code}`);
  redirect(`${quotePath(r.value.versionId)}?ok=${r.value.created ? "version_creada" : "borrador_abierto"}`);
}

function itemsFrom(fd: FormData): DraftItemInput[] {
  const descriptions = all(fd, "description");
  const supplier = all(fd, "supplier");
  const quantity = all(fd, "quantity");
  const unit = all(fd, "unit");
  const unitPrice = all(fd, "unitPrice");
  const unitCost = all(fd, "unitCost");
  const costCurrency = all(fd, "costCurrency");
  const catalog = all(fd, "catalogServiceId");
  return descriptions.map((description, i) => ({
    description,
    supplier: supplier[i] ?? null,
    quantity: quantity[i] ?? "",
    unit: unit[i] ?? "",
    unitPrice: unitPrice[i] ?? "",
    unitCost: unitCost[i] ?? "",
    costCurrency: costCurrency[i] ?? "",
    catalogServiceId: catalog[i] || null,
  }));
}

/**
 * Guarda el paso 1 (servicios y precios) o el 2 (datos y condiciones) y va al paso que pidió la
 * persona: "Guardar" se queda, "Siguiente" avanza, "Anterior" vuelve.
 */
export async function saveQuoteStepAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const versionId = str(fd, "versionId");
  const step = str(fd, "step") === "2" ? 2 : 1;
  const goTo = ["1", "2", "3"].includes(str(fd, "goTo")) ? str(fd, "goTo") : String(step);
  const part: DraftPart =
    step === 1
      ? { saleCurrency: str(fd, "saleCurrency"), exchangeRate: str(fd, "exchangeRate"), items: itemsFrom(fd) }
      : {
          title: str(fd, "quoteTitle"),
          clientName: str(fd, "clientName"),
          destination: str(fd, "destination"),
          travelStart: str(fd, "travelStart"),
          travelEnd: str(fd, "travelEnd"),
          travelers: str(fd, "travelers"),
          validUntil: str(fd, "validUntil"),
          includes: str(fd, "includes"),
          excludes: str(fd, "excludes"),
          paymentTerms: str(fd, "paymentTerms"),
          cancellationPolicy: str(fd, "cancellationPolicy"),
          showItemPrices: str(fd, "showItemPrices") === "on",
        };
  const r = await run(() => withUser(db, user, (tx) => saveDraftPart(tx, user.id, agencyId, versionId, part)));
  if (!r.ok) return failed(fd, r);
  revalidatePath(quotePath(versionId));
  redirect(`${quotePath(versionId)}?paso=${goTo}&ok=cotizacion_guardada`);
}

/** Configuración › Catálogo: crear o cambiar un servicio (solo administrador). */
export async function saveCatalogAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const id = str(fd, "catalogId") || null;
  const r = await run(() =>
    withUser(db, user, (tx) =>
      saveCatalogService(tx, user.id, agencyId, id, {
        description: str(fd, "description"),
        supplier: str(fd, "supplier"),
        unit: str(fd, "unit"),
        unitCost: str(fd, "unitCost"),
        costCurrency: str(fd, "costCurrency"),
        unitPrice: str(fd, "unitPrice"),
        priceCurrency: str(fd, "priceCurrency"),
        active: id ? str(fd, "active") === "on" : true,
      }),
    ),
  );
  if (!r.ok) return failed(fd, r);
  revalidatePath("/app/configuracion/catalogo");
  redirect(`/app/configuracion/catalogo?ok=${id ? "servicio_guardado" : "servicio_creado"}#servicio-${r.value}`);
}

/** Configuración › Cotizaciones (solo administrador). */
export async function updateQuoteSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, agencyId, db } = await ctx();
  const r = await run(() =>
    withUser(db, user, (tx) =>
      updateQuoteSettings(tx, user.id, agencyId, {
        minMarginPct: str(fd, "minMarginPct"),
        validityDays: str(fd, "validityDays"),
        defaultIncludes: str(fd, "defaultIncludes"),
        defaultExcludes: str(fd, "defaultExcludes"),
        defaultPaymentTerms: str(fd, "defaultPaymentTerms"),
        defaultCancellation: str(fd, "defaultCancellation"),
      }),
    ),
  );
  if (!r.ok) return failed(fd, r);
  revalidatePath("/app/configuracion/cotizaciones");
  redirect("/app/configuracion/cotizaciones?ok=ajustes");
}
