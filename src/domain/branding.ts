// SPEC-002c · Marca por agencia: colores, contraste y logo. Funciones puras, sin acceso a datos.

export const DEFAULT_PRIMARY = "#0F6E6E";
export const DEFAULT_ACCENT = "#F28C28";
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = ["image/png", "image/webp", "image/jpeg"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

/** Fondo de las tarjetas en cada tema; los textos de marca se ajustan para leerse sobre él. */
export const LIGHT_SURFACE = "#FFFFFF";
export const DARK_SURFACE = "#161B22";
const WHITE = "#FFFFFF";
const INK = "#111827";

/** Normaliza un color "#rrggbb" (o "rrggbb") a "#RRGGBB"; null si no es válido. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toUpperCase()}` : null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Luminancia relativa según WCAG 2.x. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG entre dos colores (1 a 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mezcla `hex` con `target` en proporción t (0 = hex, 1 = target). */
export function mix(hex: string, target: string, t: number): string {
  const a = rgb(hex);
  const b = rgb(target);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** Texto (blanco o casi negro) que mejor se lee sobre un fondo de ese color. */
export function onColor(bg: string): string {
  return contrast(bg, WHITE) >= contrast(bg, INK) ? WHITE : INK;
}

/**
 * Versión del color que se lee como texto sobre `surface` con contraste mínimo `min`
 * (AA = 4.5). Si el original ya cumple, se devuelve tal cual; si no, se oscurece o aclara.
 */
export function readableOn(hex: string, surface: string, min = 4.5): string {
  if (contrast(hex, surface) >= min) return hex;
  const target = luminance(surface) > 0.5 ? "#000000" : WHITE;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(hex, target, t);
    if (contrast(c, surface) >= min) return c;
  }
  return target;
}

/**
 * Aviso de contraste (RF-242): el color principal se usa como texto de enlaces y como fondo de
 * botones. Si como texto sobre blanco no llega a 4.5:1, se sugiere un tono que sí llega.
 */
export function contrastWarning(primary: string): { ratio: number; suggestion: string } | null {
  const ratio = contrast(primary, LIGHT_SURFACE);
  return ratio >= 4.5 ? null : { ratio: Math.round(ratio * 10) / 10, suggestion: readableOn(primary, LIGHT_SURFACE) };
}

export type BrandColors = { primary: string; accent: string };

/**
 * Variables CSS de la marca para cada tema. Los valores salen de colores ya validados
 * (normalizeHex), así que se pueden escribir en una etiqueta <style> sin riesgo.
 */
export function brandCssVars({ primary, accent }: BrandColors): { light: Record<string, string>; dark: Record<string, string> } {
  const common = {
    "--brand": primary,
    "--brand-strong": mix(primary, "#000000", 0.15),
    "--brand-contrast": onColor(primary),
    "--accent": accent,
    "--accent-contrast": onColor(accent),
  };
  return {
    light: {
      ...common,
      // El texto de marca va sobre la tarjeta y sobre las etiquetas suaves: se ajusta contra la más
      // exigente de las dos (la suave), así cumple AA en ambas.
      "--brand-text": readableOn(primary, mix(primary, LIGHT_SURFACE, 0.9)),
      "--brand-soft": mix(primary, LIGHT_SURFACE, 0.9),
      "--brand-softer": mix(primary, LIGHT_SURFACE, 0.95),
      "--brand-line": mix(primary, LIGHT_SURFACE, 0.7),
      "--accent-soft": mix(accent, LIGHT_SURFACE, 0.82),
      "--accent-text": readableOn(accent, mix(accent, LIGHT_SURFACE, 0.82)),
    },
    dark: {
      ...common,
      "--brand-text": readableOn(primary, mix(primary, DARK_SURFACE, 0.78)),
      "--brand-soft": mix(primary, DARK_SURFACE, 0.78),
      "--brand-softer": mix(primary, DARK_SURFACE, 0.88),
      "--brand-line": mix(primary, DARK_SURFACE, 0.5),
      "--accent-soft": mix(accent, DARK_SURFACE, 0.78),
      "--accent-text": readableOn(accent, mix(accent, DARK_SURFACE, 0.78)),
    },
  };
}

export function cssBlock(selector: string, vars: Record<string, string>): string {
  return `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

/** Tipo real del archivo por sus primeros bytes; no se confía en el nombre ni en lo que diga el navegador. */
export function sniffLogoType(bytes: Uint8Array): LogoType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/**
 * Revisión del logo antes de enviarlo (AC-242): tamaño y tipo real por los primeros bytes. El
 * servidor repite la misma revisión; esta evita mandar un archivo que de todos modos se rechazaría
 * (y que, si es muy grande, la plataforma cortaría antes de llegar a la acción).
 */
export function checkLogoFile(file: { size: number; head: Uint8Array }): "logo_too_big" | "logo_type" | null {
  if (file.size > LOGO_MAX_BYTES) return "logo_too_big";
  return sniffLogoType(file.head) ? null : "logo_type";
}

/** Iniciales de la agencia para cuando todavía no hay logo. */
export function agencyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}
