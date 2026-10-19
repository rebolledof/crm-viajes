import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** País que se asume cuando el número no trae indicativo (SPEC-002, decisión por defecto). */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "CO";

/** Normaliza a formato internacional E.164 o devuelve null si el número no es válido (RF-203). */
export function normalizePhone(raw: string, country: CountryCode = DEFAULT_PHONE_COUNTRY): string | null {
  const text = raw.trim();
  if (!text) return null;
  const parsed = parsePhoneNumberFromString(text, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Número legible para mostrar en pantalla. */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
