// SPEC-002c · Preferencias personales de menú y tema (RF-243, RF-244).

export const NAV_LAYOUTS = ["top", "side"] as const;
export const THEMES = ["light", "dark", "system"] as const;
export type NavLayout = (typeof NAV_LAYOUTS)[number];
export type Theme = (typeof THEMES)[number];

export type Preferences = { navLayout: NavLayout; navCollapsed: boolean; theme: Theme };

/** Valores por defecto que eligió Felipe el 2 nov 2026: menú arriba y tema claro. */
export const DEFAULT_PREFERENCES: Preferences = { navLayout: "top", navCollapsed: false, theme: "light" };

export const NAV_LAYOUT_LABELS: Record<NavLayout, string> = { top: "Arriba", side: "A la izquierda" };
export const THEME_LABELS: Record<Theme, string> = { light: "Claro", dark: "Oscuro", system: "Automático" };

export function isNavLayout(v: unknown): v is NavLayout {
  return typeof v === "string" && (NAV_LAYOUTS as readonly string[]).includes(v);
}

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}

/** Lee una fila guardada; cualquier valor desconocido vuelve al de por defecto. */
export function toPreferences(row: { navLayout?: unknown; navCollapsed?: unknown; theme?: unknown } | null | undefined): Preferences {
  return {
    navLayout: isNavLayout(row?.navLayout) ? row.navLayout : DEFAULT_PREFERENCES.navLayout,
    navCollapsed: typeof row?.navCollapsed === "boolean" ? row.navCollapsed : DEFAULT_PREFERENCES.navCollapsed,
    theme: isTheme(row?.theme) ? row.theme : DEFAULT_PREFERENCES.theme,
  };
}

/**
 * Clase del contenedor de la app según el tema (RF-243, AC-246). Se pone en el servidor, así que
 * la primera pintura ya sale con el tema elegido; "Automático" sigue al equipo por CSS.
 */
export function themeClass(theme: Theme): string {
  return theme === "dark" ? "dark" : theme === "system" ? "theme-system" : "";
}

/**
 * Ruta a la que se vuelve después de cambiar una preferencia: la misma pantalla interna de la que
 * vino la persona, sin los avisos de una acción anterior (?ok=, ?error=, ?contraste=). Cualquier
 * otra cosa vuelve a /app, para no redirigir fuera del CRM.
 */
export function backPathFrom(referer: string | null | undefined, host: string | null | undefined): string {
  if (!referer || !host) return "/app";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "/app";
  }
  if (url.host !== host) return "/app";
  if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) return "/app";
  for (const k of ["ok", "error", "contraste", "siguiente"]) url.searchParams.delete(k);
  const q = url.searchParams.toString();
  return url.pathname + (q ? `?${q}` : "");
}
