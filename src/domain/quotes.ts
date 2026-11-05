// SPEC-004 · Cotizador: reglas puras de dinero, márgenes, estados y validación antes de enviar.
// La base de datos repite el cálculo de cada ítem en un trigger (fuente de verdad de lo guardado);
// tests/integration/cotizador.test.ts comprueba que ambos dan lo mismo.
import Decimal from "decimal.js";
import { CURRENCY_DECIMALS, normalizeNumber, type Currency } from "./money";

/** Regla de redondeo de esta versión del cotizador (RF-401). Se guarda en cada versión. */
export const ROUNDING_RULE = "half_up_item_v1";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const QUOTE_UNITS = ["persona", "noche", "habitacion", "servicio"] as const;
export type QuoteUnit = (typeof QUOTE_UNITS)[number];
export const QUOTE_UNIT_LABELS: Record<QuoteUnit, string> = {
  persona: "persona",
  noche: "noche",
  habitacion: "habitación",
  servicio: "servicio",
};
export function isQuoteUnit(value: unknown): value is QuoteUnit {
  return typeof value === "string" && (QUOTE_UNITS as readonly string[]).includes(value);
}

/** Estados guardados de una versión. "vencida" no se guarda: se calcula con la fecha (alcance 12). */
export const QUOTE_STATUSES = ["borrador", "enviada", "sustituida", "aceptada", "rechazada"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export type QuoteDisplayStatus = QuoteStatus | "vencida";
export const QUOTE_STATUS_LABELS: Record<QuoteDisplayStatus, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  sustituida: "Sustituida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
};

/** Límites de lo que se puede escribir (los mismos que valida la base). */
export const QUOTE_LIMITS = {
  maxUnitAmount: "1e12",
  unitDecimals: 4,
  maxQuantity: "9999",
  quantityDecimals: 2,
  maxRate: "1000000",
  rateDecimals: 4,
  maxItems: 60,
} as const;

function parseBounded(raw: string, decimals: number, max: string, allowZero: boolean): string | null {
  const text = normalizeNumber(raw);
  if (text === null) return null;
  const value = new D(text);
  if (value.decimalPlaces() > decimals) return null;
  if (value.greaterThan(max)) return null;
  if (!allowZero && value.isZero()) return null;
  return value.toFixed();
}

/** Precio o coste unitario: hasta 4 decimales (por ejemplo 10,005 USD por noche), cero permitido. */
export function parseUnitAmount(raw: string): string | null {
  const value = parseBounded(raw, QUOTE_LIMITS.unitDecimals, QUOTE_LIMITS.maxUnitAmount, true);
  return value !== null && new D(value).lessThan(QUOTE_LIMITS.maxUnitAmount) ? value : null;
}

/** Cantidad: mayor que cero, hasta 9.999 y 2 decimales. */
export function parseQuantity(raw: string): string | null {
  return parseBounded(raw, QUOTE_LIMITS.quantityDecimals, QUOTE_LIMITS.maxQuantity, false);
}

/** Tipo de cambio: pesos por 1 dólar (por ejemplo 4.000), mayor que cero. */
export function parseExchangeRate(raw: string): string | null {
  return parseBounded(raw, QUOTE_LIMITS.rateDecimals, QUOTE_LIMITS.maxRate, false);
}

/** Redondeo al medio hacia arriba con los decimales de la moneda (COP 0, USD 2). */
export function roundMoney(value: Decimal.Value, currency: Currency): string {
  return new D(value).toDecimalPlaces(CURRENCY_DECIMALS[currency], Decimal.ROUND_HALF_UP).toFixed(CURRENCY_DECIMALS[currency]);
}

export type ItemInput = {
  quantity: string;
  unitPrice: string;
  unitCost: string;
  costCurrency: Currency;
};

/** ¿Hace falta tipo de cambio? Sí, si algún coste está en una moneda distinta de la de venta. */
export function needsExchangeRate(items: Pick<ItemInput, "costCurrency">[], saleCurrency: Currency): boolean {
  return items.some((i) => i.costCurrency !== saleCurrency);
}

/**
 * Convierte un importe de costo a la moneda de venta. El tipo de cambio es siempre pesos por
 * 1 dólar. Sin tipo de cambio y con monedas distintas devuelve null.
 */
function toSaleCurrency(amount: Decimal, from: Currency, to: Currency, rate: string | null): Decimal | null {
  if (from === to) return amount;
  if (!rate || new D(rate).lessThanOrEqualTo(0)) return null;
  return from === "USD" ? amount.times(rate) : amount.dividedBy(rate);
}

export type LineTotals = {
  /** Venta del ítem en la moneda de venta, redondeada una sola vez (cantidad × precio). */
  sale: string;
  /** Coste del ítem convertido a la moneda de venta, o null si falta el tipo de cambio. */
  cost: string | null;
};

export function lineTotals(item: ItemInput, saleCurrency: Currency, rate: string | null): LineTotals {
  const q = new D(item.quantity);
  const sale = roundMoney(q.times(item.unitPrice), saleCurrency);
  const raw = toSaleCurrency(q.times(item.unitCost), item.costCurrency, saleCurrency, rate);
  return { sale, cost: raw === null ? null : roundMoney(raw, saleCurrency) };
}

export type Indicators = {
  sale: string;
  cost: string;
  profit: string;
  /** Margen sobre venta como fracción exacta (0.2 = 20 %), o null si la venta es cero. */
  margin: string | null;
  /** Recargo sobre coste como fracción exacta, o null si el coste es cero. */
  markup: string | null;
};

/** Utilidad, margen sobre venta y recargo sobre coste (glosario; RF-402). */
export function indicators(sale: string, cost: string): Indicators {
  const s = new D(sale);
  const c = new D(cost);
  const profit = s.minus(c);
  return {
    sale: s.toFixed(),
    cost: c.toFixed(),
    profit: profit.toFixed(),
    margin: s.isZero() ? null : profit.dividedBy(s).toFixed(),
    markup: c.isZero() ? null : profit.dividedBy(c).toFixed(),
  };
}

export type QuoteTotals = Indicators & { lines: LineTotals[]; missingRate: boolean };

/** Totales de la versión: suma de los ítems ya redondeados (RF-401). */
export function quoteTotals(items: ItemInput[], saleCurrency: Currency, rate: string | null): QuoteTotals {
  const lines = items.map((i) => lineTotals(i, saleCurrency, rate));
  const missingRate = lines.some((l) => l.cost === null);
  const sale = lines.reduce((acc, l) => acc.plus(l.sale), new D(0));
  const cost = lines.reduce((acc, l) => acc.plus(l.cost ?? 0), new D(0));
  return { ...indicators(sale.toFixed(), cost.toFixed()), lines, missingRate };
}

/** Suma exacta de importes escritos como texto decimal. */
export function sumAmounts(values: string[]): string {
  return values.reduce((acc, v) => acc.plus(v), new D(0)).toFixed();
}

/** Porcentaje para mostrar con 1 decimal y coma: 0.17647 → "17,6 %". "—" si no aplica. */
export function formatPercent(fraction: string | null): string {
  if (fraction === null) return "—";
  return `${new D(fraction).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1).replace(".", ",")} %`;
}

/**
 * Aviso de margen bajo (RF-407): solo avisa, nunca bloquea. Un ítem con venta cero y coste mayor
 * que cero también avisa. minMarginPct va en puntos (10 = 10 %).
 */
export function belowMinMargin(sale: string, cost: string, minMarginPct: string): boolean {
  const s = new D(sale);
  if (s.isZero()) return new D(cost).greaterThan(0);
  return s.minus(cost).dividedBy(s).lessThan(new D(minMarginPct).dividedBy(100));
}

/** Fecha de hoy en Colombia (UTC-5 fijo) como YYYY-MM-DD. */
export function colombiaToday(now: Date): string {
  return new Date(now.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

/** Suma días a una fecha YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Estado para mostrar: una enviada cuya vigencia ya pasó se ve "Vencida" (alcance 12). */
export function displayStatus(status: QuoteStatus, validUntil: string | null, today: string): QuoteDisplayStatus {
  if (status === "enviada" && validUntil !== null && validUntil < today) return "vencida";
  return status;
}

/** Días que faltan para el vencimiento de una enviada (0 = vence hoy), o null si no aplica. */
export function daysToExpire(status: QuoteStatus, validUntil: string | null, today: string): number | null {
  if (status !== "enviada" || validUntil === null || validUntil < today) return null;
  return Math.round((Date.parse(`${validUntil}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

export type SendProblem = { code: "quote_no_items" | "exchange_rate_required" | "valid_until_past" | "valid_until_required"; field: string };

/** Lo que impide enviar una versión, con el campo a resaltar (usabilidad: conserva lo escrito). */
export function sendProblems(
  v: { saleCurrency: Currency; exchangeRate: string | null; validUntil: string | null; items: Pick<ItemInput, "costCurrency">[] },
  today: string,
): SendProblem[] {
  const out: SendProblem[] = [];
  if (!v.items.length) out.push({ code: "quote_no_items", field: "items" });
  if (needsExchangeRate(v.items, v.saleCurrency) && !v.exchangeRate) out.push({ code: "exchange_rate_required", field: "exchangeRate" });
  if (!v.validUntil) out.push({ code: "valid_until_required", field: "validUntil" });
  else if (v.validUntil < today) out.push({ code: "valid_until_past", field: "validUntil" });
  return out;
}

/** Número visible de la cotización: 42 → "0042". */
export function formatQuoteNumber(n: number): string {
  return String(n).padStart(4, "0");
}
