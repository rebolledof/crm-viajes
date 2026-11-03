// Mensajes en español para la validación del navegador (informe de QA, 2 nov 2026). El navegador
// muestra sus propios textos según su idioma ("Please fill out this field"); aquí se traducen los
// casos de ValidityState a instrucciones de la agencia. Función pura para poder probarla sin DOM.

export type ValidityLike = Pick<
  ValidityState,
  "valueMissing" | "typeMismatch" | "patternMismatch" | "tooLong" | "tooShort" | "rangeUnderflow" | "rangeOverflow" | "stepMismatch" | "badInput"
>;

export type FieldInfo = {
  /** "input", "select" o "textarea". */
  tag: string;
  /** Tipo del input: text, email, number, date, datetime-local, time, checkbox, radio… */
  type?: string;
  label?: string | null;
  min?: string;
  max?: string;
  step?: string;
  minLength?: number;
  maxLength?: number;
  length?: number;
  title?: string;
};

const DATE_TYPES = new Set(["date", "datetime-local", "time", "month", "week"]);

/** "2026-11-02" → "02/11/2026"; "2026-11-02T08:30" → "02/11/2026 08:30"; otro valor queda igual. */
export function formatLimit(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(value);
  if (!m) return value;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}` : ""}`;
}

export function validationMessage(v: ValidityLike, f: FieldInfo): string | null {
  const type = (f.type ?? "text").toLowerCase();
  const label = f.label?.replace(/\s*\*\s*$/, "").trim();
  const named = label ? ` «${label}»` : "";
  const isDate = DATE_TYPES.has(type);

  if (v.valueMissing) {
    if (type === "checkbox") return "Marca esta casilla para continuar.";
    if (type === "radio" || f.tag === "select") return `Elige una opción${label ? ` en «${label}»` : ""}.`;
    if (type === "file") return "Adjunta un archivo para continuar.";
    if (isDate) return `Completa${named || " la fecha"}: es obligatorio.`;
    return `Completa${named || " este campo"}: es obligatorio.`;
  }
  if (v.badInput) {
    if (type === "number") return "Escribe solo números, sin letras ni símbolos.";
    if (isDate) return type === "time" ? "Escribe una hora completa." : "Escribe una fecha completa (día, mes y año).";
    return "El valor no es válido. Revísalo.";
  }
  if (v.typeMismatch) {
    if (type === "email") return "Escribe un correo válido, por ejemplo nombre@dominio.com.";
    if (type === "url") return "Escribe una dirección web completa, que empiece por https://.";
    return "El formato no es válido. Revísalo.";
  }
  if (v.tooShort) return `Escribe al menos ${f.minLength} caracteres${f.length != null ? ` (llevas ${f.length})` : ""}.`;
  if (v.tooLong) return `Usa como máximo ${f.maxLength} caracteres${f.length != null ? ` (llevas ${f.length})` : ""}.`;
  if (v.rangeUnderflow) return isDate ? `No puede ser antes de ${formatLimit(f.min ?? "")}.` : `El valor mínimo es ${f.min}.`;
  if (v.rangeOverflow) return isDate ? `No puede ser después de ${formatLimit(f.max ?? "")}.` : `El valor máximo es ${f.max}.`;
  if (v.stepMismatch) {
    if (isDate) return "Elige una hora válida de la lista.";
    if (!f.step || f.step === "1") return "Escribe un número entero, sin decimales.";
    return `Usa un valor en pasos de ${f.step}.`;
  }
  if (v.patternMismatch) return f.title?.trim() || "El formato no es válido. Revísalo.";
  return null;
}
