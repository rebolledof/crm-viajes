// SPEC-004 parte 1 · Reglas de dinero del cotizador (COT-005, RF-401 a RF-403, RF-407).
// Los resultados esperados están calculados a mano, no con el mismo código.
import { describe, expect, it } from "vitest";
import { can } from "@/domain/permissions";
import {
  addDays,
  belowMinMargin,
  colombiaToday,
  daysToExpire,
  displayStatus,
  formatPercent,
  formatQuoteNumber,
  indicators,
  lineTotals,
  needsExchangeRate,
  parseExchangeRate,
  parseQuantity,
  parseUnitAmount,
  quoteTotals,
  roundMoney,
  sendProblems,
  sumAmounts,
} from "@/domain/quotes";
import { parseDraft, type DraftInput } from "@/server/quotes";
import { AppError } from "@/server/errors";

describe("indicadores (AC-400, AC-06)", () => {
  it("coste 1.000 y venta 1.250: utilidad 250, margen 20 % y recargo 25 %", () => {
    const r = indicators("1250", "1000");
    expect(r.profit).toBe("250");
    expect(r.margin).toBe("0.2");
    expect(r.markup).toBe("0.25");
    expect(formatPercent(r.margin)).toBe("20,0 %");
    expect(formatPercent(r.markup)).toBe("25,0 %");
  });
  it("con venta o coste cero el indicador que dividiría por cero es —", () => {
    expect(indicators("0", "500").margin).toBeNull();
    expect(indicators("500", "0").markup).toBeNull();
    expect(formatPercent(null)).toBe("—");
    expect(indicators("500", "0").margin).toBe("1");
  });
  it("utilidad negativa cuando se vende por debajo del coste", () => {
    const r = indicators("900", "1000");
    expect(r.profit).toBe("-100");
    expect(formatPercent(r.margin)).toBe("-11,1 %");
  });
});

describe("redondeo por moneda (RF-401, COT-005)", () => {
  it("COP sin decimales y USD con 2, el medio hacia arriba", () => {
    expect(roundMoney("1000000.4", "COP")).toBe("1000000");
    expect(roundMoney("1000000.5", "COP")).toBe("1000001");
    expect(roundMoney("30.015", "USD")).toBe("30.02");
    expect(roundMoney("30.0149", "USD")).toBe("30.01");
    expect(roundMoney("7", "USD")).toBe("7.00");
  });
  it("AC-403: un ítem COP de 1.000.000,4 queda en 1.000.000; de 1.000.000,5 en 1.000.001", () => {
    const item = { quantity: "1", unitCost: "0", costCurrency: "COP" as const };
    expect(lineTotals({ ...item, unitPrice: "1000000.4" }, "COP", null).sale).toBe("1000000");
    expect(lineTotals({ ...item, unitPrice: "1000000.5" }, "COP", null).sale).toBe("1000001");
  });
  it("AC-402: 3 × 10,005 USD = 30,02 (se redondea una vez por ítem, no el unitario)", () => {
    expect(lineTotals({ quantity: "3", unitPrice: "10.005", unitCost: "0", costCurrency: "USD" }, "USD", null).sale).toBe("30.02");
  });
  it("AC-402: 0,10 + 0,20 USD es exactamente 0,30 (sin errores de coma flotante)", () => {
    const items = ["0.10", "0.20"].map((p) => ({ quantity: "1", unitPrice: p, unitCost: "0", costCurrency: "USD" as const }));
    expect(quoteTotals(items, "USD", null).sale).toBe("0.3");
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.3");
  });
  it("el total es la suma de los ítems ya redondeados", () => {
    // 3 ítems de 1 × 0,005 USD: cada uno se redondea a 0,01 → total 0,03 (no 0,015 → 0,02).
    const items = Array.from({ length: 3 }, () => ({ quantity: "1", unitPrice: "0.005", unitCost: "0", costCurrency: "USD" as const }));
    expect(quoteTotals(items, "USD", null).sale).toBe("0.03");
  });
  it("cantidad con decimales: 2,5 noches × 120.000 COP = 300.000", () => {
    expect(lineTotals({ quantity: "2.5", unitPrice: "120000", unitCost: "0", costCurrency: "COP" }, "COP", null).sale).toBe("300000");
  });
});

describe("tipo de cambio (RF-403, AC-404)", () => {
  it("hotel de USD 150 × 4 noches con 1 USD = 4.000 COP cuesta 2.400.000 COP", () => {
    const l = lineTotals({ quantity: "4", unitPrice: "750000", unitCost: "150", costCurrency: "USD" }, "COP", "4000");
    expect(l).toEqual({ sale: "3000000", cost: "2400000" });
  });
  it("coste en COP y venta en USD divide por el tipo de cambio y redondea a 2 decimales", () => {
    // 100.000 / 3.900 = 25,6410… → 25,64
    expect(lineTotals({ quantity: "1", unitPrice: "30", unitCost: "100000", costCurrency: "COP" }, "USD", "3900").cost).toBe("25.64");
  });
  it("sin tipo de cambio el coste en otra moneda queda pendiente y se avisa", () => {
    const items = [
      { quantity: "1", unitPrice: "100", unitCost: "50", costCurrency: "USD" as const },
      { quantity: "1", unitPrice: "100", unitCost: "50", costCurrency: "COP" as const },
    ];
    expect(needsExchangeRate(items, "COP")).toBe(true);
    const t = quoteTotals(items, "COP", null);
    expect(t.missingRate).toBe(true);
    expect(t.lines[0].cost).toBeNull();
    expect(needsExchangeRate([items[1]], "COP")).toBe(false);
  });
});

describe("ejemplo de la propuesta (Cartagena, 4 noches)", () => {
  const items = [
    { quantity: "4", unitPrice: "750000", unitCost: "150", costCurrency: "USD" as const },
    { quantity: "2", unitPrice: "900000", unitCost: "800000", costCurrency: "COP" as const },
    { quantity: "1", unitPrice: "180000", unitCost: "120000", costCurrency: "COP" as const },
    { quantity: "2", unitPrice: "60000", unitCost: "55000", costCurrency: "COP" as const },
  ];
  it("total 5.100.000, coste 4.230.000, utilidad 870.000, margen 17,1 % y recargo 20,6 %", () => {
    const t = quoteTotals(items, "COP", "4000");
    expect(t.sale).toBe("5100000");
    expect(t.cost).toBe("4230000");
    expect(t.profit).toBe("870000");
    expect(formatPercent(t.margin)).toBe("17,1 %");
    expect(formatPercent(t.markup)).toBe("20,6 %");
  });
  it("AC-408: el seguro (8,3 %) queda bajo el mínimo de 10 % y los demás no", () => {
    const t = quoteTotals(items, "COP", "4000");
    expect(t.lines.map((l) => belowMinMargin(l.sale, l.cost!, "10"))).toEqual([false, false, false, true]);
    expect(formatPercent(indicators(t.lines[3].sale, t.lines[3].cost!).margin)).toBe("8,3 %");
    expect(belowMinMargin(t.sale, t.cost, "10")).toBe(false);
  });
  it("venta cero con coste avisa; venta y coste cero no", () => {
    expect(belowMinMargin("0", "100", "10")).toBe(true);
    expect(belowMinMargin("0", "0", "10")).toBe(false);
    expect(belowMinMargin("110", "99", "10")).toBe(false); // justo 10 %
  });
});

describe("lo que escribe la persona", () => {
  it("precios con formato colombiano y hasta 4 decimales", () => {
    expect(parseUnitAmount("1.250.000")).toBe("1250000");
    expect(parseUnitAmount("10,005")).toBe("10.005");
    expect(parseUnitAmount("0")).toBe("0");
    expect(parseUnitAmount("1,23456")).toBeNull();
    expect(parseUnitAmount("-5")).toBeNull();
    expect(parseUnitAmount("abc")).toBeNull();
    expect(parseUnitAmount("1000000000000")).toBeNull();
  });
  it("cantidad mayor que cero, hasta 9.999 y 2 decimales", () => {
    expect(parseQuantity("2")).toBe("2");
    expect(parseQuantity("2,5")).toBe("2.5");
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("10000")).toBeNull();
    expect(parseQuantity("1,234")).toBeNull();
  });
  it("tipo de cambio en pesos por dólar", () => {
    expect(parseExchangeRate("4.000")).toBe("4000");
    expect(parseExchangeRate("3.950,25")).toBe("3950.25");
    expect(parseExchangeRate("0")).toBeNull();
  });
});

describe("estados y vigencia (alcance 12, AC-416)", () => {
  it("una enviada cuya vigencia pasó se ve Vencida; el último día todavía no", () => {
    expect(displayStatus("enviada", "2026-12-23", "2026-12-23")).toBe("enviada");
    expect(displayStatus("enviada", "2026-12-23", "2026-12-24")).toBe("vencida");
    expect(displayStatus("aceptada", "2026-12-23", "2026-12-24")).toBe("aceptada");
    expect(displayStatus("borrador", "2026-12-23", "2026-12-24")).toBe("borrador");
  });
  it("días para vencer: 1 el 22 dic, 0 el 23 y nada después", () => {
    expect(daysToExpire("enviada", "2026-12-23", "2026-12-22")).toBe(1);
    expect(daysToExpire("enviada", "2026-12-23", "2026-12-23")).toBe(0);
    expect(daysToExpire("enviada", "2026-12-23", "2026-12-24")).toBeNull();
    expect(daysToExpire("sustituida", "2026-12-23", "2026-12-22")).toBeNull();
  });
  it("la fecha de hoy es la de Colombia (UTC-5)", () => {
    expect(colombiaToday(new Date("2026-12-23T04:59:00Z"))).toBe("2026-12-22");
    expect(colombiaToday(new Date("2026-12-23T05:00:00Z"))).toBe("2026-12-23");
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
  });
  it("número visible con 4 cifras", () => {
    expect(formatQuoteNumber(42)).toBe("0042");
    expect(formatQuoteNumber(12345)).toBe("12345");
  });
});

describe("antes de enviar (RF-403)", () => {
  const ok = { saleCurrency: "COP" as const, exchangeRate: null, validUntil: "2026-12-23", items: [{ costCurrency: "COP" as const }] };
  it("sin problemas no devuelve nada", () => {
    expect(sendProblems(ok, "2026-12-18")).toEqual([]);
  });
  it("sin servicios, sin tipo de cambio o con vigencia vencida, señala el campo", () => {
    expect(sendProblems({ ...ok, items: [] }, "2026-12-18")).toEqual([{ code: "quote_no_items", field: "items" }]);
    expect(sendProblems({ ...ok, items: [{ costCurrency: "USD" }] }, "2026-12-18")).toEqual([{ code: "exchange_rate_required", field: "exchangeRate" }]);
    expect(sendProblems({ ...ok, validUntil: "2026-12-17" }, "2026-12-18")).toEqual([{ code: "valid_until_past", field: "validUntil" }]);
    expect(sendProblems({ ...ok, validUntil: null }, "2026-12-18")).toEqual([{ code: "valid_until_required", field: "validUntil" }]);
  });
});

describe("permisos del cotizador (RF-410)", () => {
  it("admin y asesor cotizan y ven costes; Lectura no; solo admin configura", () => {
    expect(can("asesor", "quotes.write")).toBe(true);
    expect(can("asesor", "quotes.costs")).toBe(true);
    expect(can("lectura", "quotes.write")).toBe(false);
    expect(can("lectura", "quotes.costs")).toBe(false);
    expect(can("admin", "quotes.manage")).toBe(true);
    expect(can("asesor", "quotes.manage")).toBe(false);
  });
});

describe("validación del borrador (AC-417)", () => {
  const base: DraftInput = {
    title: "Cartagena, 4 noches",
    clientName: "Laura Pineda",
    saleCurrency: "COP",
    showItemPrices: true,
    items: [{ description: "Hotel", quantity: "4", unit: "noche", unitPrice: "750.000", unitCost: "150", costCurrency: "USD" }],
  };
  const fieldOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof AppError ? `${e.code}:${e.field}` : "otro";
    }
    return "sin error";
  };
  it("acepta un borrador correcto y normaliza los importes", () => {
    const d = parseDraft({ ...base, exchangeRate: "4.000" });
    expect(d.exchangeRate).toBe("4000");
    expect(d.items[0]).toMatchObject({ unitPrice: "750000", unitCost: "150", quantity: "4" });
  });
  it("un ítem sin descripción señala ese ítem", () => {
    const items = [base.items[0], { ...base.items[0], description: "  " }];
    expect(fieldOf(() => parseDraft({ ...base, items }))).toBe("invalid_input:description.1");
  });
  it("un precio mal escrito o una cantidad cero señalan su campo", () => {
    expect(fieldOf(() => parseDraft({ ...base, items: [{ ...base.items[0], unitPrice: "mil" }] }))).toBe("invalid_input:unitPrice.0");
    expect(fieldOf(() => parseDraft({ ...base, items: [{ ...base.items[0], quantity: "0" }] }))).toBe("invalid_input:quantity.0");
    expect(fieldOf(() => parseDraft({ ...base, items: [{ ...base.items[0], unit: "kilo" }] }))).toBe("invalid_input:unit.0");
  });
  it("coste vacío vale 0", () => {
    expect(parseDraft({ ...base, items: [{ ...base.items[0], unitCost: "" }] }).items[0].unitCost).toBe("0");
  });
  it("título, regreso antes de la ida y tipo de cambio inválido", () => {
    expect(fieldOf(() => parseDraft({ ...base, title: "" }))).toBe("invalid_input:quoteTitle");
    expect(fieldOf(() => parseDraft({ ...base, travelStart: "2027-01-16", travelEnd: "2027-01-12" }))).toBe("invalid_input:travelEnd");
    expect(fieldOf(() => parseDraft({ ...base, exchangeRate: "0" }))).toBe("invalid_input:exchangeRate");
    expect(fieldOf(() => parseDraft({ ...base, saleCurrency: "EUR" }))).toBe("invalid_input:saleCurrency");
  });
});

// SPEC-004 parte 2: lo que muestra la pantalla de armar la cotización.
import * as Q from "@/domain/quotes";
import { parseCatalog } from "@/server/quotes";
import { errorMessage } from "@/server/errors";

describe("pantalla del cotizador (parte 2)", () => {
  it("importes como en las imágenes aprobadas: punto de miles, coma decimal y la moneda después", () => {
    expect(Q.formatAmount("5100000", "COP")).toBe("5.100.000 COP");
    expect(Q.formatAmount("30.015", "USD")).toBe("30,02 USD");
    expect(Q.formatAmount("0.3", "USD")).toBe("0,30 USD");
    expect(Q.formatDecimal("10005.5")).toBe("10.005,5");
    expect(Q.formatDecimal("150")).toBe("150");
  });

  it("hallazgo B4: «10.005» se muestra como se entendió (diez mil cinco) y «10,005» como diez con 5 milésimas", () => {
    expect(Q.formatDecimal(Q.parseUnitAmount("10.005")!)).toBe("10.005");
    expect(Q.formatDecimal(Q.parseUnitAmount("10,005")!)).toBe("10,005");
    // Lo que escribió en la pantalla vuelve igual al recargar (sin perder decimales).
    expect(Q.parseUnitAmount(Q.formatDecimal("10.005"))).toBe("10.005");
    expect(Q.parseUnitAmount(Q.formatDecimal("1250000.5"))).toBe("1250000.5");
  });

  it("cantidad con su unidad en singular o plural", () => {
    expect(Q.unitLabel("noche", "4", Q.formatDecimal)).toBe("4 noches");
    expect(Q.unitLabel("servicio", "1")).toBe("1 servicio");
    expect(Q.unitLabel("habitacion", "1.5", Q.formatDecimal)).toBe("1,5 habitaciones");
  });

  it("ajustes: margen mínimo de 0 a 90 % con hasta 2 decimales y vigencia de 1 a 90 días", () => {
    expect(Q.parseMinMarginPct("10")).toBe("10");
    expect(Q.parseMinMarginPct("12,5 %")).toBe("12.5");
    expect(Q.parseMinMarginPct("0")).toBe("0");
    expect(Q.parseMinMarginPct("95")).toBeNull();
    expect(Q.parseMinMarginPct("1,234")).toBeNull();
    expect(Q.parseMinMarginPct("diez")).toBeNull();
    expect(Q.parseValidityDays("5")).toBe(5);
    expect(Q.parseValidityDays("0")).toBeNull();
    expect(Q.parseValidityDays("91")).toBeNull();
    expect(Q.parseValidityDays("2.5")).toBeNull();
  });

  it("pasos de la guía: cualquier valor raro de la URL abre el paso 1", () => {
    expect(Q.parseStep("2")).toBe(2);
    expect(Q.parseStep("3")).toBe(3);
    expect(Q.parseStep(undefined)).toBe(1);
    expect(Q.parseStep("9")).toBe(1);
  });

  it("catálogo: valida cada campo y lo liga a su casilla", () => {
    const ok = parseCatalog({ description: "Traslado", unit: "servicio", unitCost: "120.000", costCurrency: "COP", unitPrice: "180.000", priceCurrency: "COP", active: true });
    expect(ok).toMatchObject({ unitCost: "120000", unitPrice: "180000", supplier: null });
    const fieldOf = (patch: Record<string, unknown>) => {
      try {
        parseCatalog({ description: "Traslado", unit: "servicio", unitCost: "1", costCurrency: "COP", unitPrice: "2", priceCurrency: "COP", active: true, ...patch });
      } catch (e) {
        return e instanceof AppError ? e.field : "otro";
      }
      return null;
    };
    expect(fieldOf({ description: " " })).toBe("description");
    expect(fieldOf({ unitPrice: "abc" })).toBe("unitPrice");
    expect(fieldOf({ unitCost: "-5" })).toBe("unitCost");
    expect(fieldOf({ priceCurrency: "EUR" })).toBe("priceCurrency");
    expect(fieldOf({ unit: "kilo" })).toBe("unit");
  });

  it("cada campo nuevo tiene un mensaje que dice cómo corregirlo", () => {
    for (const f of ["minMarginPct", "validityDays", "priceCurrency", "includes", "cancellationPolicy", "defaultIncludes"]) {
      expect(errorMessage("invalid_input", f), f).not.toBe(errorMessage("invalid_input"));
    }
    expect(errorMessage("invalid_input", "description.3")).toBe("Escribe qué servicio es (máximo 300 caracteres).");
  });
});
