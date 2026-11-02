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
