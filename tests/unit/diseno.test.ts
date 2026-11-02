// SPEC-002c · Reglas puras del diseño: marca, preferencias y guía paso a paso.
import { describe, expect, it } from "vitest";
import {
  DARK_SURFACE,
  DEFAULT_ACCENT,
  DEFAULT_PRIMARY,
  LIGHT_SURFACE,
  agencyInitials,
  brandCssVars,
  contrast,
  contrastWarning,
  cssBlock,
  mix,
  normalizeHex,
  onColor,
  readableOn,
  sniffLogoType,
} from "@/domain/branding";
import { DEFAULT_PREFERENCES, backPathFrom, isNavLayout, isTheme, themeClass, toPreferences } from "@/domain/preferences";
import { TASK_ACTION_LABELS, dayPlan, nextStepStatus, stagePath } from "@/domain/guide";
import { TASK_KINDS } from "@/domain/tasks";

describe("colores de la marca (RF-241, RF-242)", () => {
  it("normaliza #rrggbb y rechaza lo que no es un color", () => {
    expect(normalizeHex("#0f6e6e")).toBe("#0F6E6E");
    expect(normalizeHex(" c2185b ")).toBe("#C2185B");
    for (const bad of ["#FFF", "#GGGGGG", "red", "", null, 42, "#0F6E6E;}body{display:none", "url(x)"]) expect(normalizeHex(bad)).toBeNull();
  });

  it("calcula el contraste WCAG: negro sobre blanco es 21 y un color consigo mismo es 1", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrast(DEFAULT_PRIMARY, DEFAULT_PRIMARY)).toBeCloseTo(1, 5);
  });

  it("elige texto blanco u oscuro según el fondo, siempre legible", () => {
    expect(onColor("#0F6E6E")).toBe("#FFFFFF");
    expect(onColor("#FFB300")).not.toBe("#FFFFFF");
    for (const c of ["#0F6E6E", "#C2185B", "#FFB300", "#7FD1FF", "#F5F5F5", "#000000"]) expect(contrast(onColor(c), c)).toBeGreaterThanOrEqual(4.5);
  });

  it("ajusta el texto de marca hasta cumplir AA sobre la superficie de cada tema (RF-249)", () => {
    for (const c of ["#0F6E6E", "#C2185B", "#7FD1FF", "#F5F5F5", "#1A1A1A", "#FFB300"]) {
      expect(contrast(readableOn(c, LIGHT_SURFACE), LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(readableOn(c, DARK_SURFACE), DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableOn("#0F6E6E", LIGHT_SURFACE)).toBe("#0F6E6E");
  });

  it("avisa cuando el color principal es muy claro y sugiere un tono legible (AC-243)", () => {
    const w = contrastWarning("#F5F5F5");
    expect(w).not.toBeNull();
    expect(contrast(w!.suggestion, LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastWarning(DEFAULT_PRIMARY)).toBeNull();
  });

  it("mezcla colores en los extremos", () => {
    expect(mix("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mix("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
  });

  it("produce las variables CSS de los dos temas y un bloque sin caracteres peligrosos", () => {
    const v = brandCssVars({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT });
    for (const k of ["--brand", "--brand-strong", "--brand-contrast", "--brand-text", "--brand-soft", "--accent", "--accent-contrast", "--accent-text", "--accent-soft"]) {
      expect(v.light[k]).toMatch(/^#[0-9A-F]{6}$/);
      expect(v.dark[k]).toMatch(/^#[0-9A-F]{6}$/);
    }
    for (const c of [DEFAULT_PRIMARY, "#C2185B", "#7FD1FF", "#0F4C81", "#FFB300"]) {
      const x = brandCssVars({ primary: c, accent: DEFAULT_ACCENT });
      // El texto de marca se lee sobre la tarjeta y sobre la etiqueta suave, en los dos temas (RF-249).
      expect(contrast(x.light["--brand-text"], LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(x.light["--brand-text"], x.light["--brand-soft"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(x.dark["--brand-text"], DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(x.dark["--brand-text"], x.dark["--brand-soft"])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(v.light["--accent-text"], v.light["--accent-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.dark["--accent-text"], v.dark["--accent-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(cssBlock(":root", v.light)).toMatch(/^:root\{--brand:#0F6E6E;/);
    expect(cssBlock(":root", v.light)).not.toMatch(/[<>]/);
  });
});

describe("logo (RF-242)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
  const enc = (s: string) => new Uint8Array(Buffer.from(s));

  it("reconoce PNG, JPG y WebP por sus bytes", () => {
    expect(sniffLogoType(png)).toBe("image/png");
    expect(sniffLogoType(jpg)).toBe("image/jpeg");
    expect(sniffLogoType(webp)).toBe("image/webp");
  });

  it("rechaza SVG, PDF, HTML y archivos vacíos aunque digan ser imágenes", () => {
    for (const bad of [enc("<svg xmlns='http://www.w3.org/2000/svg'/>"), enc("%PDF-1.7"), enc("<html>"), new Uint8Array()]) expect(sniffLogoType(bad)).toBeNull();
  });

  it("arma las iniciales de la agencia para cuando no hay logo", () => {
    expect(agencyInitials("Andes Travel")).toBe("AT");
    expect(agencyInitials("caribe sol viajes")).toBe("CS");
    expect(agencyInitials("Turismo")).toBe("TU");
    expect(agencyInitials("  ")).toBe("?");
  });
});

describe("preferencias personales (RF-243, RF-244)", () => {
  it("por defecto el menú va arriba, abierto, y el tema es claro (AC-244)", () => {
    expect(DEFAULT_PREFERENCES).toEqual({ navLayout: "top", navCollapsed: false, theme: "light" });
    expect(toPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });

  it("acepta solo los valores conocidos; lo demás vuelve al de por defecto", () => {
    expect(isNavLayout("side")).toBe(true);
    expect(isNavLayout("bottom")).toBe(false);
    expect(isTheme("system")).toBe(true);
    expect(isTheme("rosa")).toBe(false);
    expect(toPreferences({ navLayout: "side", navCollapsed: true, theme: "dark" })).toEqual({ navLayout: "side", navCollapsed: true, theme: "dark" });
    expect(toPreferences({ navLayout: "x", navCollapsed: "si", theme: 3 })).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("tema y regreso tras cambiar una preferencia", () => {
  it("el contenedor lleva la clase del tema desde el servidor (AC-246)", () => {
    expect(themeClass("light")).toBe("");
    expect(themeClass("dark")).toBe("dark");
    expect(themeClass("system")).toBe("theme-system");
  });

  it("vuelve a la misma pantalla interna sin repetir avisos anteriores", () => {
    const host = "crm.ejemplo.test";
    expect(backPathFrom("https://crm.ejemplo.test/app/contactos?q=ana&ok=creado", host)).toBe("/app/contactos?q=ana");
    expect(backPathFrom("https://crm.ejemplo.test/app/configuracion/marca?ok=marca&contraste=%2346738C", host)).toBe("/app/configuracion/marca");
    expect(backPathFrom("https://crm.ejemplo.test/app/oportunidades/1?siguiente=1&error=x", host)).toBe("/app/oportunidades/1");
    expect(backPathFrom("https://crm.ejemplo.test/app", host)).toBe("/app");
  });

  it("nunca redirige fuera del CRM ni a rutas que no son de la app", () => {
    const host = "crm.ejemplo.test";
    for (const bad of [null, "", "nada", "https://malo.test/app", "https://crm.ejemplo.test/login", "https://crm.ejemplo.test/apple", "//malo.test/app"]) {
      expect(backPathFrom(bad, host)).toBe("/app");
    }
    expect(backPathFrom("https://crm.ejemplo.test/app/x", null)).toBe("/app");
  });
});

describe("plan del día (RF-245)", () => {
  it("con vencidas, el paso actual es atenderlas (AC-247)", () => {
    const plan = dayPlan({ overdue: 2, today: 3, withoutNext: 1 });
    expect(plan.map((s) => s.key)).toEqual(["vencidas", "hoy", "sin_paso", "listo"]);
    expect(plan.map((s) => s.state)).toEqual(["actual", "pendiente", "pendiente", "pendiente"]);
    expect(plan[0].detail).toBe("2 pendientes");
  });

  it("sin vencidas avanza a las de hoy y marca las anteriores como hechas", () => {
    expect(dayPlan({ overdue: 0, today: 1, withoutNext: 0 }).map((s) => s.state)).toEqual(["hecho", "actual", "pendiente", "pendiente"]);
    expect(dayPlan({ overdue: 0, today: 0, withoutNext: 4 }).map((s) => s.state)).toEqual(["hecho", "hecho", "actual", "pendiente"]);
  });

  it("sin nada pendiente, el día queda al día", () => {
    const plan = dayPlan({ overdue: 0, today: 0, withoutNext: 0 });
    expect(plan.map((s) => s.state)).toEqual(["hecho", "hecho", "hecho", "actual"]);
    expect(plan[2].detail).toBe("Todas tienen plan");
  });

  it("usa singular y plural", () => {
    expect(dayPlan({ overdue: 1, today: 0, withoutNext: 1 })[2].detail).toBe("1 oportunidad sin plan");
  });
});

describe("camino de etapas (RF-246)", () => {
  const stages = [
    { id: "a", name: "Nuevo", kind: "abierta" as const },
    { id: "b", name: "Contactado", kind: "abierta" as const },
    { id: "c", name: "Propuesta", kind: "abierta" as const },
    { id: "d", name: "Negociación", kind: "abierta" as const },
    { id: "g", name: "Ganado", kind: "ganada" as const },
    { id: "p", name: "Perdido", kind: "perdida" as const },
  ];

  it("en la tercera etapa, las dos primeras están hechas y las demás pendientes (AC-248)", () => {
    const path = stagePath(stages, { stageId: "c", kind: "abierta" });
    expect(path.map((s) => s.name)).toEqual(["Nuevo", "Contactado", "Propuesta", "Negociación", "Cerrar"]);
    expect(path.map((s) => s.state)).toEqual(["hecho", "hecho", "actual", "pendiente", "pendiente"]);
  });

  it("una oportunidad ganada o perdida termina en el cierre con su etapa", () => {
    const won = stagePath(stages, { stageId: "g", kind: "ganada" });
    expect(won.at(-1)).toEqual({ id: "cierre", name: "Ganado", state: "actual", closed: "ganada" });
    expect(won.slice(0, -1).every((s) => s.state === "hecho")).toBe(true);
    expect(stagePath(stages, { stageId: "p", kind: "perdida" }).at(-1)?.closed).toBe("perdida");
  });

  it("si la etapa actual se desactivó, ninguna etapa abierta se marca como actual", () => {
    const path = stagePath(stages, { stageId: "zz", kind: "abierta" });
    expect(path.some((s) => s.state === "actual")).toBe(false);
  });
});

describe("siguiente paso de un contacto (alcance 5)", () => {
  const now = new Date("2026-11-02T15:00:00Z"); // 10:00 en Colombia
  it("clasifica por vencimiento y avisa si hay oportunidades sin tarea", () => {
    expect(nextStepStatus({ dueAt: new Date("2026-11-01T15:00:00Z"), openOpportunities: 1 }, now)).toBe("vencida");
    expect(nextStepStatus({ dueAt: new Date("2026-11-02T22:00:00Z"), openOpportunities: 1 }, now)).toBe("hoy");
    expect(nextStepStatus({ dueAt: new Date("2026-11-05T15:00:00Z"), openOpportunities: 0 }, now)).toBe("programada");
    expect(nextStepStatus({ dueAt: null, openOpportunities: 2 }, now)).toBe("sin_paso");
    expect(nextStepStatus({ dueAt: null, openOpportunities: 0 }, now)).toBe("sin_oportunidad");
  });

  it("cada tipo de tarea tiene un verbo para su botón", () => {
    for (const k of TASK_KINDS) expect(TASK_ACTION_LABELS[k]).toBeTruthy();
  });
});
