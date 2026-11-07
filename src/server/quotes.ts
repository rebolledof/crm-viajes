// SPEC-004 · Cotizador: casos de uso sobre una transacción de usuario (withUser).
// La base aplica las mismas reglas (RLS, versiones inmutables, totales); aquí se valida antes
// para devolver errores ligados a su campo y conservar lo escrito.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { agencies, agencyBranding, catalogServices, contacts, memberships, opportunities, pipelineStages, quoteItems, quotePdfs, quoteSettings, quoteVersionCosts, quoteVersions, quotes } from "@/db/schema";
import { createHash } from "node:crypto";
import { renderQuotePdf, type QuotePdfData } from "./quote-pdf";
import { isCurrency, type Currency } from "@/domain/money";
import Decimal from "decimal.js";
import { can } from "@/domain/permissions";
import {
  QUOTE_LIMITS,
  addDays,
  belowMinMargin,
  colombiaToday,
  daysToExpire,
  displayStatus,
  indicators,
  lineTotals,
  isQuoteUnit,
  parseExchangeRate,
  parseMinMarginPct,
  parseValidityDays,
  parseQuantity,
  parseUnitAmount,
  sumAmounts,
  type QuoteUnit,
} from "@/domain/quotes";
import { recordAudit, requirePermission } from "./agencies";
import { logActivity } from "./contacts";
import { moveOpportunity } from "./opportunities";
import { AppError, fieldError, pgError, requireIds, rethrowBusiness } from "./errors";

const DEFAULT_SETTINGS = { minMarginPct: "10.00", validityDays: 5, defaultIncludes: null, defaultExcludes: null, defaultPaymentTerms: null, defaultCancellation: null };

export async function getQuoteSettings(tx: Tx, userId: string, agencyId: string) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const [row] = await tx.select().from(quoteSettings).where(eq(quoteSettings.agencyId, agencyId));
  return row ?? { agencyId, ...DEFAULT_SETTINGS };
}

/** Crea la cotización y su versión 1 en borrador, con los datos de la oportunidad (alcance 1). */
export async function createQuote(tx: Tx, userId: string, agencyId: string, input: { opportunityId: string; now: Date }): Promise<{ quoteId: string; versionId: string; number: number }> {
  await requirePermission(tx, userId, agencyId, "quotes.write");
  requireIds(input.opportunityId);
  const [opp] = await tx
    .select({ opp: opportunities, contactName: contacts.fullName })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .where(and(eq(opportunities.id, input.opportunityId), eq(opportunities.agencyId, agencyId)));
  if (!opp) throw new AppError("not_found");
  const settings = await getQuoteSettings(tx, userId, agencyId);
  try {
    const [quote] = await tx.insert(quotes).values({ agencyId, opportunityId: input.opportunityId, createdBy: userId }).returning({ id: quotes.id, number: quotes.number });
    const destination = opp.opp.destination?.trim() || null;
    const [version] = await tx
      .insert(quoteVersions)
      .values({
        agencyId,
        quoteId: quote.id,
        title: destination ?? "Cotización",
        clientName: opp.contactName.slice(0, 160),
        destination,
        travelStart: opp.opp.travelStart,
        travelEnd: opp.opp.travelEnd,
        travelers: opp.opp.travelers,
        saleCurrency: opp.opp.budgetCurrency ?? "COP",
        validUntil: addDays(colombiaToday(input.now), settings.validityDays),
        includes: settings.defaultIncludes,
        excludes: settings.defaultExcludes,
        paymentTerms: settings.defaultPaymentTerms,
        cancellationPolicy: settings.defaultCancellation,
        createdBy: userId,
      })
      .returning({ id: quoteVersions.id });
    await recordAudit(tx, { agencyId, actorId: userId, action: "quote.created", objectType: "quote", objectId: quote.id, changes: { numero: quote.number, oportunidad: input.opportunityId } });
    await logActivity(tx, { agencyId, contactId: opp.opp.contactId, opportunityId: input.opportunityId, actorId: userId, kind: "cotizacion.creada", data: { numero: quote.number } });
    return { quoteId: quote.id, versionId: version.id, number: quote.number };
  } catch (err) {
    rethrowBusiness(err);
  }
}

export type DraftItemInput = {
  description: string;
  supplier?: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  unitCost?: string | null;
  costCurrency: string;
  catalogServiceId?: string | null;
};

export type DraftInput = {
  title: string;
  clientName: string;
  destination?: string | null;
  travelStart?: string | null;
  travelEnd?: string | null;
  travelers?: string | null;
  saleCurrency: string;
  exchangeRate?: string | null;
  validUntil?: string | null;
  includes?: string | null;
  excludes?: string | null;
  paymentTerms?: string | null;
  cancellationPolicy?: string | null;
  showItemPrices: boolean;
  items: DraftItemInput[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optionalText(raw: string | null | undefined, max: number, field: string): string | null {
  const text = raw?.trim() ?? "";
  if (text.length > max) throw fieldError("invalid_input", field);
  return text || null;
}

function optionalDate(raw: string | null | undefined, field: string): string | null {
  const text = raw?.trim() ?? "";
  if (!text) return null;
  if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw fieldError("invalid_input", field);
  return text;
}

type ParsedItem = { description: string; supplier: string | null; quantity: string; unit: QuoteUnit; unitPrice: string; unitCost: string; costCurrency: Currency; catalogServiceId: string | null };

/** Valida el borrador completo. El primer problema se devuelve ligado a su campo (unitPrice.2). */
export function parseDraft(input: DraftInput) {
  const title = input.title?.trim() ?? "";
  if (!title || title.length > 160) throw fieldError("invalid_input", "quoteTitle");
  const clientName = input.clientName?.trim() ?? "";
  if (!clientName || clientName.length > 160) throw fieldError("invalid_input", "clientName");
  const destination = optionalText(input.destination, 160, "destination");
  const travelStart = optionalDate(input.travelStart, "travelStart");
  const travelEnd = optionalDate(input.travelEnd, "travelEnd");
  if (travelStart && travelEnd && travelEnd < travelStart) throw fieldError("invalid_input", "travelEnd");
  let travelers: number | null = null;
  if (input.travelers?.trim()) {
    travelers = Number(input.travelers.trim());
    if (!Number.isInteger(travelers) || travelers < 1 || travelers > 999) throw fieldError("invalid_input", "travelers");
  }
  if (!isCurrency(input.saleCurrency)) throw fieldError("invalid_input", "saleCurrency");
  let exchangeRate: string | null = null;
  if (input.exchangeRate?.trim()) {
    exchangeRate = parseExchangeRate(input.exchangeRate);
    if (!exchangeRate) throw fieldError("invalid_input", "exchangeRate");
  }
  const validUntil = optionalDate(input.validUntil, "validUntil");
  const includes = optionalText(input.includes, 4000, "includes");
  const excludes = optionalText(input.excludes, 4000, "excludes");
  const paymentTerms = optionalText(input.paymentTerms, 4000, "paymentTerms");
  const cancellationPolicy = optionalText(input.cancellationPolicy, 4000, "cancellationPolicy");
  if (input.items.length > QUOTE_LIMITS.maxItems) throw fieldError("invalid_input", "items");
  const items: ParsedItem[] = input.items.map((it, i) => {
    const description = it.description?.trim() ?? "";
    if (!description || description.length > 300) throw fieldError("invalid_input", `description.${i}`);
    const supplier = optionalText(it.supplier, 160, `supplier.${i}`);
    const quantity = parseQuantity(it.quantity ?? "");
    if (!quantity) throw fieldError("invalid_input", `quantity.${i}`);
    if (!isQuoteUnit(it.unit)) throw fieldError("invalid_input", `unit.${i}`);
    const unitPrice = parseUnitAmount(it.unitPrice ?? "");
    if (unitPrice === null) throw fieldError("invalid_input", `unitPrice.${i}`);
    const unitCost = it.unitCost?.trim() ? parseUnitAmount(it.unitCost) : "0";
    if (unitCost === null) throw fieldError("invalid_input", `unitCost.${i}`);
    if (!isCurrency(it.costCurrency)) throw fieldError("invalid_input", `costCurrency.${i}`);
    const catalogServiceId = it.catalogServiceId || null;
    requireIds(catalogServiceId);
    return { description, supplier, quantity, unit: it.unit, unitPrice, unitCost, costCurrency: it.costCurrency, catalogServiceId };
  });
  // Ningún total puede pasar de 999.999.999.999 (columnas numeric(14,2)): se avisa en su campo en
  // vez de dejar que la base falle con un error técnico (informe de QA, 5 nov 2026).
  const MAX = new Decimal("1e12");
  let total = new Decimal(0);
  items.forEach((it, i) => {
    const line = lineTotals(it, input.saleCurrency as Currency, exchangeRate);
    if (new Decimal(line.sale).greaterThanOrEqualTo(MAX)) throw new AppError("amount_too_large", undefined, `unitPrice.${i}`);
    if (line.cost !== null && new Decimal(line.cost).greaterThanOrEqualTo(MAX)) throw new AppError("amount_too_large", undefined, `unitCost.${i}`);
    total = total.plus(line.sale);
  });
  if (total.greaterThanOrEqualTo(MAX)) throw new AppError("amount_too_large", undefined, "items");
  return { title, clientName, destination, travelStart, travelEnd, travelers, saleCurrency: input.saleCurrency, exchangeRate, validUntil, includes, excludes, paymentTerms, cancellationPolicy, showItemPrices: !!input.showItemPrices, items };
}

/** Guarda el borrador: datos, condiciones y la lista completa de ítems (reemplaza los anteriores). */
export async function saveDraft(tx: Tx, userId: string, agencyId: string, versionId: string, input: DraftInput): Promise<void> {
  await requirePermission(tx, userId, agencyId, "quotes.write");
  requireIds(versionId);
  const draft = parseDraft(input);
  const [current] = await tx.select({ status: quoteVersions.status }).from(quoteVersions).where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId)));
  if (!current) throw new AppError("not_found");
  if (current.status !== "borrador") throw new AppError("quote_version_locked");
  const { items, exchangeRate, ...header } = draft;
  try {
    await tx.update(quoteVersions).set(header).where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId)));
    await tx
      .insert(quoteVersionCosts)
      .values({ quoteVersionId: versionId, agencyId, exchangeRate })
      .onConflictDoUpdate({ target: quoteVersionCosts.quoteVersionId, set: { exchangeRate } });
    await tx.delete(quoteItems).where(and(eq(quoteItems.quoteVersionId, versionId), eq(quoteItems.agencyId, agencyId)));
    if (items.length) {
      await tx.insert(quoteItems).values(items.map((it, position) => ({ ...it, agencyId, quoteVersionId: versionId, position })));
    }
  } catch (err) {
    rethrowBusiness(err);
  }
}

/**
 * Crea la versión siguiente copiando cualquier versión anterior (alcance 11). Si ya hay un
 * borrador abierto, lo devuelve en vez de crear otro (RF-413, AC-414).
 */
export async function createNextVersion(tx: Tx, userId: string, agencyId: string, fromVersionId: string): Promise<{ versionId: string; created: boolean }> {
  await requirePermission(tx, userId, agencyId, "quotes.write");
  requireIds(fromVersionId);
  const [source] = await tx.select().from(quoteVersions).where(and(eq(quoteVersions.id, fromVersionId), eq(quoteVersions.agencyId, agencyId)));
  if (!source) throw new AppError("not_found");
  const [draft] = await tx.select({ id: quoteVersions.id }).from(quoteVersions).where(and(eq(quoteVersions.quoteId, source.quoteId), eq(quoteVersions.status, "borrador")));
  if (draft) return { versionId: draft.id, created: false };
  const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteVersionId, fromVersionId)).orderBy(asc(quoteItems.position), asc(quoteItems.createdAt));
  const [costs] = await tx.select({ exchangeRate: quoteVersionCosts.exchangeRate }).from(quoteVersionCosts).where(eq(quoteVersionCosts.quoteVersionId, fromVersionId));
  try {
    const [created] = await tx
      .insert(quoteVersions)
      .values({
        agencyId,
        quoteId: source.quoteId,
        title: source.title,
        clientName: source.clientName,
        destination: source.destination,
        travelStart: source.travelStart,
        travelEnd: source.travelEnd,
        travelers: source.travelers,
        saleCurrency: source.saleCurrency,
        validUntil: source.validUntil,
        includes: source.includes,
        excludes: source.excludes,
        paymentTerms: source.paymentTerms,
        cancellationPolicy: source.cancellationPolicy,
        showItemPrices: source.showItemPrices,
        createdBy: userId,
      })
      .returning({ id: quoteVersions.id, version: quoteVersions.version });
    if (costs?.exchangeRate) await tx.insert(quoteVersionCosts).values({ quoteVersionId: created.id, agencyId, exchangeRate: costs.exchangeRate });
    if (items.length) {
      await tx.insert(quoteItems).values(
        items.map((it) => ({
          agencyId,
          quoteVersionId: created.id,
          position: it.position,
          description: it.description,
          supplier: it.supplier,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          unitCost: it.unitCost,
          costCurrency: it.costCurrency,
          catalogServiceId: it.catalogServiceId,
        })),
      );
    }
    await recordAudit(tx, { agencyId, actorId: userId, action: "quote.version_created", objectType: "quote", objectId: source.quoteId, changes: { version: created.version, desde: source.version } });
    return { versionId: created.id, created: true };
  } catch (err) {
    // Otra persona creó el borrador al mismo tiempo (índice de un solo borrador).
    if (pgError(err)?.code === "23505") throw new AppError("quote_draft_exists");
    rethrowBusiness(err);
  }
}

type ClientItem = { id: string; position: number; description: string; quantity: string; unit: QuoteUnit; unitPrice: string; lineTotal: string };

/**
 * Una versión con sus ítems. Coste, utilidad y margen solo si el rol puede verlos (RF-406): para
 * Lectura los ítems salen de app.quote_items_for_client, que no tiene esas columnas.
 */
export async function getQuoteVersion(tx: Tx, userId: string, agencyId: string, versionId: string, now: Date) {
  const role = await requirePermission(tx, userId, agencyId, "crm.read");
  requireIds(versionId);
  const [row] = await tx
    .select({ version: quoteVersions, number: quotes.number, opportunityId: quotes.opportunityId })
    .from(quoteVersions)
    .innerJoin(quotes, eq(quotes.id, quoteVersions.quoteId))
    .where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId)));
  if (!row) throw new AppError("not_found");
  // El logo copiado al enviar solo lo usa el PDF (parte 4); no viaja con la versión.
  const { brandLogo, ...version } = row.version;
  void brandLogo;
  const today = colombiaToday(now);
  const base = {
    number: row.number,
    opportunityId: row.opportunityId,
    // Lista blanca: lo mismo que verá el cliente, sin datos internos (RF-406).
    version: {
      id: version.id,
      quoteId: version.quoteId,
      version: version.version,
      status: version.status,
      title: version.title,
      clientName: version.clientName,
      destination: version.destination,
      travelStart: version.travelStart,
      travelEnd: version.travelEnd,
      travelers: version.travelers,
      saleCurrency: version.saleCurrency,
      validUntil: version.validUntil,
      includes: version.includes,
      excludes: version.excludes,
      paymentTerms: version.paymentTerms,
      cancellationPolicy: version.cancellationPolicy,
      showItemPrices: version.showItemPrices,
      saleTotal: version.saleTotal,
      brand: version.brand,
      sentAt: version.sentAt,
      sentBy: version.sentBy,
      decidedAt: version.decidedAt,
      decidedBy: version.decidedBy,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
    },
    status: displayStatus(version.status, version.validUntil, today),
    daysToExpire: daysToExpire(version.status, version.validUntil, today),
  };
  if (!can(role, "quotes.costs")) {
    const rows = (await tx.execute(sql`select id, position, description, quantity::text as quantity, unit::text as unit, unit_price::text as unit_price, line_total::text as line_total from app.quote_items_for_client(${versionId})`)) as unknown as Record<string, string | number>[];
    const items: ClientItem[] = rows.map((r) => ({ id: String(r.id), position: Number(r.position), description: String(r.description), quantity: String(r.quantity), unit: r.unit as QuoteUnit, unitPrice: String(r.unit_price), lineTotal: String(r.line_total) }));
    return { ...base, canSeeCosts: false as const, items, saleTotal: sumAmounts(items.map((i) => i.lineTotal)) };
  }
  const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteVersionId, versionId)).orderBy(asc(quoteItems.position), asc(quoteItems.createdAt));
  const [costs] = await tx.select().from(quoteVersionCosts).where(eq(quoteVersionCosts.quoteVersionId, versionId));
  const minMargin = costs?.minMarginPct ?? (await getQuoteSettings(tx, userId, agencyId)).minMarginPct;
  const missingRate = items.some((i) => i.lineCost === null);
  const withIndicators = items.map((i) => ({
    ...i,
    ...(i.lineCost === null ? { profit: null, margin: null, markup: null, lowMargin: false } : (() => {
      const ind = indicators(i.lineTotal, i.lineCost);
      return { profit: ind.profit, margin: ind.margin, markup: ind.markup, lowMargin: belowMinMargin(i.lineTotal, i.lineCost, minMargin) };
    })()),
  }));
  const saleTotal = sumAmounts(items.map((i) => i.lineTotal));
  const costTotal = sumAmounts(items.map((i) => i.lineCost ?? "0"));
  const totals = indicators(saleTotal, costTotal);
  return {
    ...base,
    canSeeCosts: true as const,
    items: withIndicators,
    saleTotal,
    totals,
    missingRate,
    exchangeRate: costs?.exchangeRate ?? null,
    minMarginPct: minMargin,
    lowMarginTotal: !missingRate && belowMinMargin(saleTotal, costTotal, minMargin),
  };
}

/** Cotizaciones de una oportunidad con su versión vigente y su historial (alcance 13). */
export async function listOpportunityQuotes(tx: Tx, userId: string, agencyId: string, opportunityId: string, now: Date) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  requireIds(opportunityId);
  const qs = await tx.select().from(quotes).where(and(eq(quotes.opportunityId, opportunityId), eq(quotes.agencyId, agencyId))).orderBy(asc(quotes.number));
  if (!qs.length) return [];
  const versions = await tx
    .select({
      id: quoteVersions.id,
      quoteId: quoteVersions.quoteId,
      version: quoteVersions.version,
      status: quoteVersions.status,
      title: quoteVersions.title,
      saleCurrency: quoteVersions.saleCurrency,
      saleTotal: quoteVersions.saleTotal,
      validUntil: quoteVersions.validUntil,
      sentAt: quoteVersions.sentAt,
      sentBy: quoteVersions.sentBy,
    })
    .from(quoteVersions)
    .where(inArray(quoteVersions.quoteId, qs.map((q) => q.id)))
    .orderBy(desc(quoteVersions.version));
  const today = colombiaToday(now);
  return qs.map((q) => {
    const history = versions
      .filter((v) => v.quoteId === q.id)
      .map((v) => ({ ...v, displayStatus: displayStatus(v.status, v.validUntil, today), daysToExpire: daysToExpire(v.status, v.validUntil, today) }));
    const current = history.find((v) => v.status !== "borrador") ?? null;
    const draft = history.find((v) => v.status === "borrador") ?? null;
    return { id: q.id, number: q.number, current, draft, history };
  });
}

/** Lo que falta en DraftInput para editar un paso sin tocar los otros (pantalla de 3 pasos). */
export type DraftPart = Partial<DraftInput>;

/**
 * Guarda un paso del borrador: toma lo guardado de la versión y reemplaza solo lo que trae el paso
 * (paso 1: moneda, tipo de cambio y servicios; paso 2: datos del viaje y condiciones).
 */
export async function saveDraftPart(tx: Tx, userId: string, agencyId: string, versionId: string, part: DraftPart): Promise<void> {
  await requirePermission(tx, userId, agencyId, "quotes.write");
  requireIds(versionId);
  // Bloquea la versión: si dos pestañas guardan pasos distintos a la vez, la segunda lee lo que
  // guardó la primera y no la pisa (prueba independiente de la parte 2, hallazgo 3).
  await tx.execute(sql`select 1 from public.quote_versions where id = ${versionId} and agency_id = ${agencyId} for update`);
  const v = await getQuoteVersion(tx, userId, agencyId, versionId, new Date());
  if (!v.canSeeCosts) throw new AppError("permission_denied");
  if (v.version.status !== "borrador") throw new AppError("quote_version_locked");
  const h = v.version;
  const current: DraftInput = {
    title: h.title,
    clientName: h.clientName,
    destination: h.destination,
    travelStart: h.travelStart,
    travelEnd: h.travelEnd,
    travelers: h.travelers == null ? null : String(h.travelers),
    saleCurrency: h.saleCurrency,
    exchangeRate: v.exchangeRate,
    validUntil: h.validUntil,
    includes: h.includes,
    excludes: h.excludes,
    paymentTerms: h.paymentTerms,
    cancellationPolicy: h.cancellationPolicy,
    showItemPrices: h.showItemPrices,
    items: v.items.map((i) => ({ description: i.description, supplier: i.supplier, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, unitCost: i.unitCost, costCurrency: i.costCurrency, catalogServiceId: i.catalogServiceId })),
  };
  await saveDraft(tx, userId, agencyId, versionId, { ...current, ...part });
}

/** Todo lo que necesita la pantalla de una versión: la versión, su oportunidad y las demás versiones. */
export async function getQuoteScreen(tx: Tx, userId: string, agencyId: string, versionId: string, now: Date) {
  const v = await getQuoteVersion(tx, userId, agencyId, versionId, now);
  const [opp] = await tx
    .select({ id: opportunities.id, destination: opportunities.destination, contactId: opportunities.contactId, contactName: contacts.fullName, stageName: pipelineStages.name, stageKind: pipelineStages.kind })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.id, v.opportunityId), eq(opportunities.agencyId, agencyId)));
  if (!opp) throw new AppError("not_found");
  const today = colombiaToday(now);
  const versions = (
    await tx
      .select({ id: quoteVersions.id, version: quoteVersions.version, status: quoteVersions.status, validUntil: quoteVersions.validUntil, saleTotal: quoteVersions.saleTotal, saleCurrency: quoteVersions.saleCurrency, sentAt: quoteVersions.sentAt, sentBy: quoteVersions.sentBy, decidedAt: quoteVersions.decidedAt, decidedBy: quoteVersions.decidedBy })
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteId, v.version.quoteId), eq(quoteVersions.agencyId, agencyId)))
      .orderBy(desc(quoteVersions.version))
  ).map((r) => ({ ...r, displayStatus: displayStatus(r.status, r.validUntil, today) }));
  return { ...v, opportunity: opp, versions };
}

// ---------------------------------------------------------------------------------------------
// Catálogo simple (alcance 16, T-022)

export type CatalogInput = {
  description: string;
  supplier?: string | null;
  unit: string;
  unitCost: string;
  costCurrency: string;
  unitPrice: string;
  priceCurrency: string;
  active: boolean;
};

/** Servicios del catálogo. Lectura no lo ve (tiene costes). Por defecto, solo los activos. */
export async function listCatalog(tx: Tx, userId: string, agencyId: string, opts: { includeInactive?: boolean } = {}) {
  await requirePermission(tx, userId, agencyId, "quotes.costs");
  const where = opts.includeInactive ? eq(catalogServices.agencyId, agencyId) : and(eq(catalogServices.agencyId, agencyId), eq(catalogServices.active, true));
  return tx.select().from(catalogServices).where(where).orderBy(desc(catalogServices.active), asc(sql`lower(${catalogServices.description})`));
}

export function parseCatalog(input: CatalogInput) {
  const description = input.description?.trim() ?? "";
  if (!description || description.length > 300) throw fieldError("invalid_input", "description");
  const supplier = optionalText(input.supplier, 160, "supplier");
  if (!isQuoteUnit(input.unit)) throw fieldError("invalid_input", "unit");
  const unitCost = input.unitCost?.trim() ? parseUnitAmount(input.unitCost) : "0";
  if (unitCost === null) throw fieldError("invalid_input", "unitCost");
  if (!isCurrency(input.costCurrency)) throw fieldError("invalid_input", "costCurrency");
  const unitPrice = parseUnitAmount(input.unitPrice ?? "");
  if (unitPrice === null) throw fieldError("invalid_input", "unitPrice");
  if (!isCurrency(input.priceCurrency)) throw fieldError("invalid_input", "priceCurrency");
  return { description, supplier, unit: input.unit, unitCost, costCurrency: input.costCurrency, unitPrice, priceCurrency: input.priceCurrency, active: !!input.active };
}

/** Crea (id null) o cambia un servicio del catálogo. Solo el administrador (RF-410). */
export async function saveCatalogService(tx: Tx, userId: string, agencyId: string, id: string | null, input: CatalogInput): Promise<string> {
  await requirePermission(tx, userId, agencyId, "quotes.manage");
  requireIds(id);
  const data = parseCatalog(input);
  try {
    if (!id) {
      const [row] = await tx.insert(catalogServices).values({ ...data, agencyId, createdBy: userId }).returning({ id: catalogServices.id });
      await recordAudit(tx, { agencyId, actorId: userId, action: "catalog.created", objectType: "catalog_service", objectId: row.id, changes: { description: data.description } });
      return row.id;
    }
    const [row] = await tx.update(catalogServices).set(data).where(and(eq(catalogServices.id, id), eq(catalogServices.agencyId, agencyId))).returning({ id: catalogServices.id });
    if (!row) throw new AppError("not_found");
    await recordAudit(tx, { agencyId, actorId: userId, action: "catalog.updated", objectType: "catalog_service", objectId: id, changes: { description: data.description, active: data.active } });
    return id;
  } catch (err) {
    rethrowBusiness(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Configuración › Cotizaciones (alcance 17)

export type QuoteSettingsInput = {
  minMarginPct: string;
  validityDays: string;
  defaultIncludes?: string | null;
  defaultExcludes?: string | null;
  defaultPaymentTerms?: string | null;
  defaultCancellation?: string | null;
};

export async function updateQuoteSettings(tx: Tx, userId: string, agencyId: string, input: QuoteSettingsInput): Promise<void> {
  await requirePermission(tx, userId, agencyId, "quotes.manage");
  const minMarginPct = parseMinMarginPct(input.minMarginPct ?? "");
  if (minMarginPct === null) throw fieldError("invalid_input", "minMarginPct");
  const validityDays = parseValidityDays(input.validityDays ?? "");
  if (validityDays === null) throw fieldError("invalid_input", "validityDays");
  const data = {
    minMarginPct,
    validityDays,
    defaultIncludes: optionalText(input.defaultIncludes, 4000, "defaultIncludes"),
    defaultExcludes: optionalText(input.defaultExcludes, 4000, "defaultExcludes"),
    defaultPaymentTerms: optionalText(input.defaultPaymentTerms, 4000, "defaultPaymentTerms"),
    defaultCancellation: optionalText(input.defaultCancellation, 4000, "defaultCancellation"),
    updatedBy: userId,
  };
  try {
    await tx.insert(quoteSettings).values({ agencyId, ...data }).onConflictDoUpdate({ target: quoteSettings.agencyId, set: data });
    await recordAudit(tx, { agencyId, actorId: userId, action: "quote_settings.updated", objectType: "agency", objectId: agencyId, changes: { minMarginPct, validityDays } });
  } catch (err) {
    rethrowBusiness(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Parte 3: enviar, aceptar y rechazar (alcance 10 a 14; RF-404, RF-408, RF-409).

/** Nombre de la etapa a la que se mueve la oportunidad al enviar (RF-408). */
export const PROPOSAL_STAGE_NAME = "Propuesta enviada";
const normalizeStage = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

type SendPlan = { stageName: string; target: { id: string; name: string } | null; willMove: boolean; reason: "mueve" | "ya_despues" | "cerrada" | "sin_etapa" };

/**
 * Qué pasará con la oportunidad al enviar: pasa a "Propuesta enviada" si está en una etapa abierta
 * anterior; se queda si ya está en esa etapa o después, si está cerrada o si la agencia no tiene una
 * etapa activa con ese nombre (la renombró o la desactivó).
 */
async function sendPlan(tx: Tx, agencyId: string, opportunityId: string): Promise<SendPlan> {
  const [cur] = await tx
    .select({ name: pipelineStages.name, position: pipelineStages.position, kind: pipelineStages.kind })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.agencyId, agencyId)));
  if (!cur) throw new AppError("not_found");
  const stages = await tx
    .select({ id: pipelineStages.id, name: pipelineStages.name, position: pipelineStages.position })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.agencyId, agencyId), eq(pipelineStages.active, true), eq(pipelineStages.kind, "abierta")));
  const target = stages.find((s) => normalizeStage(s.name) === normalizeStage(PROPOSAL_STAGE_NAME)) ?? null;
  if (cur.kind !== "abierta") return { stageName: cur.name, target, willMove: false, reason: "cerrada" };
  if (!target) return { stageName: cur.name, target: null, willMove: false, reason: "sin_etapa" };
  if (cur.position >= target.position) return { stageName: cur.name, target, willMove: false, reason: "ya_despues" };
  return { stageName: cur.name, target: { id: target.id, name: target.name }, willMove: true, reason: "mueve" };
}

/** Para la confirmación de envío: qué pasará con la oportunidad. */
export async function getSendPlan(tx: Tx, userId: string, agencyId: string, versionId: string): Promise<SendPlan> {
  await requirePermission(tx, userId, agencyId, "quotes.write");
  requireIds(versionId);
  const [row] = await tx
    .select({ opportunityId: quotes.opportunityId })
    .from(quoteVersions)
    .innerJoin(quotes, eq(quotes.id, quoteVersions.quoteId))
    .where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId)));
  if (!row) throw new AppError("not_found");
  return sendPlan(tx, agencyId, row.opportunityId);
}

async function lockVersion(tx: Tx, agencyId: string, versionId: string) {
  requireIds(versionId);
  const rows = await tx.execute<{ id: string; quote_id: string; version: number; status: string; number: number; opportunity_id: string; sale_currency: string }>(sql`
    select v.id, v.quote_id, v.version, v.status::text as status, q.number, q.opportunity_id, v.sale_currency::text as sale_currency
    from public.quote_versions v join public.quotes q on q.id = v.quote_id
    where v.id = ${versionId} and v.agency_id = ${agencyId}
    for update of v`);
  if (!rows[0]) throw new AppError("not_found");
  return rows[0];
}

/**
 * Envía un borrador (alcance 10): la base valida y congela la versión (total, marca, margen mínimo),
 * las enviadas anteriores pasan a Sustituida, la oportunidad avanza a "Propuesta enviada" si estaba
 * antes (con su seguimiento automático de S02b) y queda en la auditoría.
 */
export async function sendQuoteVersion(tx: Tx, userId: string, agencyId: string, versionId: string): Promise<{ movedTo: string | null; sustituidas: number }> {
  await requirePermission(tx, userId, agencyId, "quotes.write");
  const v = await lockVersion(tx, agencyId, versionId);
  // Otra persona la envió hace un momento (o se pulsó dos veces): decirlo claro.
  if (v.status !== "borrador") throw new AppError("quote_already_sent");
  const before = await tx.select({ id: quoteVersions.id }).from(quoteVersions).where(and(eq(quoteVersions.quoteId, v.quote_id), eq(quoteVersions.status, "enviada"))).for("update");
  let sent;
  try {
    [sent] = await tx.update(quoteVersions).set({ status: "enviada" }).where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId))).returning({ saleTotal: quoteVersions.saleTotal });
  } catch (err) {
    rethrowBusiness(err);
  }
  if (!sent) throw new AppError("not_found");
  // El PDF se genera una vez, con los datos ya congelados, y se guarda con la versión (RF-404).
  await storeQuotePdf(tx, userId, agencyId, versionId);
  const plan = await sendPlan(tx, agencyId, v.opportunity_id);
  if (plan.willMove && plan.target) {
    // Reusa el cambio de etapa del embudo: actividad, auditoría y la plantilla de seguimiento.
    await moveOpportunity(tx, userId, agencyId, v.opportunity_id, { stageId: plan.target.id });
  }
  await recordAudit(tx, {
    agencyId,
    actorId: userId,
    action: "quote.sent",
    objectType: "quote",
    objectId: v.quote_id,
    changes: { numero: v.number, version: v.version, total: sent.saleTotal, moneda: v.sale_currency, etapa: plan.willMove ? plan.target?.name : null },
  });
  return { movedTo: plan.willMove ? plan.target!.name : null, sustituidas: before.length };
}

/** "El cliente aceptó esta versión" o "El cliente la rechazó" (alcance 13, AC-415). */
export async function decideQuoteVersion(tx: Tx, userId: string, agencyId: string, versionId: string, decision: "aceptada" | "rechazada"): Promise<{ opportunityId: string }> {
  await requirePermission(tx, userId, agencyId, "quotes.write");
  const v = await lockVersion(tx, agencyId, versionId);
  if (v.status === "aceptada" || v.status === "rechazada") throw new AppError("quote_already_decided");
  if (v.status !== "enviada") throw new AppError("invalid_quote_transition");
  try {
    await tx.update(quoteVersions).set({ status: decision }).where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId)));
  } catch (err) {
    // Otra versión de la misma cotización ya está aceptada (índice de una sola aceptada).
    if (pgError(err)?.code === "23505") throw new AppError("quote_already_accepted");
    rethrowBusiness(err);
  }
  await recordAudit(tx, {
    agencyId,
    actorId: userId,
    action: decision === "aceptada" ? "quote.accepted" : "quote.rejected",
    objectType: "quote",
    objectId: v.quote_id,
    changes: { numero: v.number, version: v.version },
  });
  return { opportunityId: v.opportunity_id };
}

/** Días de anticipación del aviso de Mi día (alcance 14). */
export const EXPIRING_SOON_DAYS = 2;

/**
 * Mi día (alcance 14, AC-416): cotizaciones enviadas sin respuesta que vencen hoy o en los próximos
 * 2 días (hora de Colombia), de oportunidades de la persona o que ella envió.
 */
export async function expiringQuotes(tx: Tx, userId: string, agencyId: string, now: Date) {
  await requirePermission(tx, userId, agencyId, "crm.read");
  const today = colombiaToday(now);
  const rows = await tx
    .select({
      versionId: quoteVersions.id,
      version: quoteVersions.version,
      number: quotes.number,
      title: quoteVersions.title,
      clientName: quoteVersions.clientName,
      saleTotal: quoteVersions.saleTotal,
      saleCurrency: quoteVersions.saleCurrency,
      validUntil: quoteVersions.validUntil,
      opportunityId: quotes.opportunityId,
    })
    .from(quoteVersions)
    .innerJoin(quotes, eq(quotes.id, quoteVersions.quoteId))
    .innerJoin(opportunities, eq(opportunities.id, quotes.opportunityId))
    .where(
      and(
        eq(quoteVersions.agencyId, agencyId),
        eq(quoteVersions.status, "enviada"),
        sql`${quoteVersions.validUntil} between ${today}::date and ${addDays(today, EXPIRING_SOON_DAYS)}::date`,
        sql`(${opportunities.ownerId} = ${userId} or ${quoteVersions.sentBy} = ${userId})`,
      ),
    )
    .orderBy(asc(quoteVersions.validUntil), asc(quotes.number));
  return rows.map((r) => ({ ...r, daysToExpire: daysToExpire("enviada", r.validUntil, today) ?? 0 }));
}

// ---------------------------------------------------------------------------------------------
// Parte 4: PDF (alcance 15; RF-404, RF-406; AC-401, AC-405, AC-407).

/** Datos del PDF: solo lo que ve el cliente. Una enviada usa la marca y el logo congelados al enviar. */
async function pdfData(tx: Tx, agencyId: string, versionId: string, now: Date): Promise<QuotePdfData & { status: string }> {
  const [row] = await tx
    .select({ v: quoteVersions, number: quotes.number })
    .from(quoteVersions)
    .innerJoin(quotes, eq(quotes.id, quoteVersions.quoteId))
    .where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId)));
  if (!row) throw new AppError("not_found");
  const v = row.v;
  const items = (await tx.execute(
    sql`select description, quantity::text as quantity, unit::text as unit, line_total::text as line_total from app.quote_items_for_client(${versionId}) order by position`,
  )) as unknown as { description: string; quantity: string; unit: string; line_total: string }[];
  let brand: { name: string; primaryColor: string; logo: QuotePdfData["logo"] };
  if (v.status !== "borrador" && v.brand) {
    const b = v.brand as { name?: string; primary_color?: string };
    brand = { name: b.name ?? "", primaryColor: b.primary_color ?? "#0F6E6E", logo: v.brandLogo && v.brandLogoType ? { bytes: new Uint8Array(v.brandLogo), type: v.brandLogoType } : null };
  } else {
    const [a] = await tx.select({ name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId));
    const [b] = await tx.select().from(agencyBranding).where(eq(agencyBranding.agencyId, agencyId));
    brand = { name: a?.name ?? "", primaryColor: b?.primaryColor ?? "#0F6E6E", logo: b?.logo && b.logoType ? { bytes: new Uint8Array(b.logo), type: b.logoType } : null };
  }
  const advisorId = v.sentBy ?? v.createdBy;
  const [advisor] = await tx.select({ email: memberships.email }).from(memberships).where(and(eq(memberships.agencyId, agencyId), eq(memberships.userId, advisorId)));
  return {
    status: v.status,
    agencyName: brand.name,
    primaryColor: brand.primaryColor,
    logo: brand.logo,
    number: row.number,
    version: v.version,
    draft: v.status === "borrador",
    issuedAt: v.sentAt ?? now,
    validUntil: v.validUntil,
    title: v.title,
    clientName: v.clientName,
    destination: v.destination,
    travelStart: v.travelStart,
    travelEnd: v.travelEnd,
    travelers: v.travelers,
    currency: v.saleCurrency as Currency,
    showItemPrices: v.showItemPrices,
    items: items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit as QuoteUnit, lineTotal: i.line_total })),
    total: v.saleTotal ?? sumAmounts(items.map((i) => i.line_total)),
    includes: v.includes,
    excludes: v.excludes,
    paymentTerms: v.paymentTerms,
    cancellationPolicy: v.cancellationPolicy,
    advisorEmail: advisor?.email ?? null,
  };
}

/** Dibuja el PDF; un fallo inesperado (por ejemplo un logo dañado) se vuelve un mensaje claro y la transacción se deshace. */
async function renderPdf(data: QuotePdfData): Promise<Uint8Array> {
  try {
    return (await renderQuotePdf(data)).bytes;
  } catch (err) {
    console.error("quote_pdf_render_failed", err);
    throw new AppError("pdf_failed");
  }
}

/** Genera y guarda el PDF de una versión enviada (una sola vez; la base no deja cambiarlo). */
async function storeQuotePdf(tx: Tx, userId: string, agencyId: string, versionId: string): Promise<Uint8Array> {
  const data = await pdfData(tx, agencyId, versionId, new Date());
  const bytes = await renderPdf(data);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    await tx.insert(quotePdfs).values({ quoteVersionId: versionId, agencyId, pdf: Buffer.from(bytes), sha256, createdBy: userId }).onConflictDoNothing();
  } catch (err) {
    rethrowBusiness(err);
  }
  const [stored] = await tx.select({ pdf: quotePdfs.pdf }).from(quotePdfs).where(eq(quotePdfs.quoteVersionId, versionId));
  return stored ? new Uint8Array(stored.pdf) : bytes;
}

/**
 * "Descargar PDF": el guardado de una versión enviada; si es de antes de la parte 4, se genera con
 * los datos congelados y se guarda. Un borrador da una vista previa marcada "BORRADOR" que no se guarda.
 */
export async function getQuotePdf(tx: Tx, userId: string, agencyId: string, versionId: string, now: Date): Promise<{ bytes: Uint8Array; filename: string; draft: boolean }> {
  const role = await requirePermission(tx, userId, agencyId, "crm.read");
  requireIds(versionId);
  const [row] = await tx
    .select({ status: quoteVersions.status, version: quoteVersions.version, number: quotes.number })
    .from(quoteVersions)
    .innerJoin(quotes, eq(quotes.id, quoteVersions.quoteId))
    .where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId)));
  if (!row) throw new AppError("not_found");
  const filename = `Cotizacion-${formatQuoteNumberPlain(row.number)}-v${row.version}${row.status === "borrador" ? "-borrador" : ""}.pdf`;
  if (row.status === "borrador") {
    return { bytes: await renderPdf(await pdfData(tx, agencyId, versionId, now)), filename, draft: true };
  }
  const [stored] = await tx.select({ pdf: quotePdfs.pdf }).from(quotePdfs).where(eq(quotePdfs.quoteVersionId, versionId));
  if (stored) return { bytes: new Uint8Array(stored.pdf), filename, draft: false };
  // Enviada antes de que existiera el PDF: los datos están congelados, así que el resultado es el mismo
  // que se habría generado al enviar. Lectura no escribe: lo recibe sin guardarlo.
  if (can(role, "quotes.write")) return { bytes: await storeQuotePdf(tx, userId, agencyId, versionId), filename, draft: false };
  return { bytes: await renderPdf(await pdfData(tx, agencyId, versionId, now)), filename, draft: false };
}

const formatQuoteNumberPlain = (n: number) => String(n).padStart(4, "0");
