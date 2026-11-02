import Decimal from "decimal.js";

/** Monedas del piloto y sus decimales (SPEC-000 RF-12). */
export const CURRENCIES = ["COP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CURRENCY_DECIMALS: Record<Currency, number> = { COP: 0, USD: 2 };

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Convierte lo que escribe la persona ("4.500.000", "1250,50") en un importe exacto como texto,
 * listo para numeric(14,2). Devuelve null si no es un importe válido para la moneda.
 */
export function parseAmount(raw: string, currency: Currency): string | null {
  let text = raw.trim().replace(/\s/g, "").replace(/^\$/, "");
  if (!text) return null;
  // Formato colombiano: punto de miles y coma decimal.
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(text) || /^\d+,\d+$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = new Decimal(text);
  if (value.decimalPlaces() > CURRENCY_DECIMALS[currency]) return null;
  if (value.greaterThanOrEqualTo("1e12")) return null;
  return value.toFixed(CURRENCY_DECIMALS[currency]);
}

export function formatMoney(amount: string, currency: Currency): string {
  const value = new Decimal(amount);
  const decimals = CURRENCY_DECIMALS[currency];
  const [int, frac] = value.toFixed(decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${currency} ${frac ? `${grouped},${frac}` : grouped}`;
}
