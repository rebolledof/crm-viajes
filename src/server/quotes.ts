// SPEC-004 · Cotizador: casos de uso sobre una transacción de usuario (withUser).
// La base aplica las mismas reglas (RLS, versiones inmutables, totales); aquí se valida antes
// para devolver errores ligados a su campo y conservar lo escrito.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { contacts, opportunities, quoteItems, quoteSettings, quoteVersions, quotes } from "@/db/schema";
import { isCurrency, type Currency } from "@/domain/money";
import { can } from "@/domain/permissions";
import {
  QUOTE_LIMITS,
  addDays,
  belowMinMargin,
  colombiaToday,
  daysToExpire,
  displayStatus,
  indicators,
  isQuoteUnit,
  parseExchangeRate,
  parseQuantity,
  parseUnitAmount,
  sumAmounts,
  type QuoteUnit,
} from "@/domain/quotes";
import { recordAudit, requirePermission } from "./agencies";
import { logActivity } from "./contacts";
import { AppError, fieldError, requireIds, rethrowBusiness } from "./errors";

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
  const includes = optionalText(input.includes, 4000, "conditions");
  const excludes = optionalText(input.excludes, 4000, "conditions");
  const paymentTerms = optionalText(input.paymentTerms, 4000, "conditions");
  const cancellationPolicy = optionalText(input.cancellationPolicy, 4000, "conditions");
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
  const { items, ...header } = draft;
  try {
    await tx.update(quoteVersions).set(header).where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.agencyId, agencyId)));
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
        exchangeRate: source.exchangeRate,
        validUntil: source.validUntil,
        includes: source.includes,
        excludes: source.excludes,
        paymentTerms: source.paymentTerms,
        cancellationPolicy: source.cancellationPolicy,
        showItemPrices: source.showItemPrices,
        createdBy: userId,
      })
      .returning({ id: quoteVersions.id, version: quoteVersions.version });
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
    version,
    status: displayStatus(version.status, version.validUntil, today),
    daysToExpire: daysToExpire(version.status, version.validUntil, today),
  };
  if (!can(role, "quotes.costs")) {
    const rows = (await tx.execute(sql`select id, position, description, quantity::text as quantity, unit::text as unit, unit_price::text as unit_price, line_total::text as line_total from app.quote_items_for_client(${versionId})`)) as unknown as Record<string, string | number>[];
    const items: ClientItem[] = rows.map((r) => ({ id: String(r.id), position: Number(r.position), description: String(r.description), quantity: String(r.quantity), unit: r.unit as QuoteUnit, unitPrice: String(r.unit_price), lineTotal: String(r.line_total) }));
    return { ...base, canSeeCosts: false as const, items, saleTotal: sumAmounts(items.map((i) => i.lineTotal)) };
  }
  const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteVersionId, versionId)).orderBy(asc(quoteItems.position), asc(quoteItems.createdAt));
  const minMargin = version.minMarginPct ?? (await getQuoteSettings(tx, userId, agencyId)).minMarginPct;
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
