// SPEC-004 parte 4 · PDF de la cotización, sin base de datos.
import { describe, expect, it } from "vitest";
import { renderQuotePdf, type QuotePdfData } from "../../src/server/quote-pdf";
import { pdfText, tinyPng } from "../pdf-helpers";

const base: QuotePdfData = {
  agencyName: "Andes Travel",
  primaryColor: "#0F6E6E",
  logo: null,
  number: 3,
  version: 1,
  draft: false,
  issuedAt: new Date("2026-11-06T15:00:00Z"),
  validUntil: "2026-11-11",
  title: "Cartagena, 4 noches para 2 adultos",
  clientName: "Laura Pineda",
  destination: "Cartagena",
  travelStart: "2027-01-12",
  travelEnd: "2027-01-16",
  travelers: 2,
  currency: "COP",
  showItemPrices: true,
  items: [{ description: "Traslado aeropuerto", quantity: "1", unit: "servicio", lineTotal: "1250" }],
  total: "1250",
  includes: "Desayuno diario",
  excludes: null,
  paymentTerms: "50 % para reservar",
  cancellationPolicy: null,
  advisorEmail: "asesora@example.com",
};

describe("PDF de la cotización (alcance 15)", () => {
  it("lleva número, versión, vigencia, cliente, servicios, total con moneda, condiciones y pie", async () => {
    const { bytes, text } = await renderQuotePdf(base);
    const all = text.join("\n");
    for (const s of ["Cotización N.º 0003", "Versión 1 · 6 de noviembre de 2026", "Válida hasta el 11 de noviembre de 2026", "Para Laura Pineda · Cartagena", "Traslado aeropuerto", "1.250 COP", "Incluye", "Desayuno diario", "Forma de pago", "Andes Travel · Asesor: asesora@example.com", "Página 1 de 1"]) {
      expect(all).toContain(s);
    }
    expect(all).not.toContain("No incluye");
    // Lo que se dibuja es lo que queda en el archivo.
    expect(pdfText(bytes).join("\n")).toContain("1.250 COP");
  });

  it("los mismos datos dan los mismos bytes (un solo PDF por versión)", async () => {
    const a = await renderQuotePdf(base);
    const b = await renderQuotePdf(base);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it("solo total: sin el precio de cada servicio", async () => {
    const { text } = await renderQuotePdf({ ...base, showItemPrices: false, items: [...base.items, { description: "Seguro", quantity: "2", unit: "persona", lineTotal: "120000" }], total: "121250" });
    expect(text).not.toContain("1.250 COP");
    expect(text).not.toContain("120.000 COP");
    expect(text).toContain("121.250 COP");
    expect(text).toContain("2 personas");
  });

  it("textos largos pasan de línea y de página; letras que la fuente no tiene se cambian por «?»", async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Condición número ${i + 1} con detalle suficiente para ocupar una línea completa del documento.`).join("\n");
    const { text } = await renderQuotePdf({ ...base, cancellationPolicy: long, title: "Viaje 🌴 a Cartagena ≠ Bogotá", items: [{ description: "x".repeat(400), quantity: "1", unit: "servicio", lineTotal: "1250" }] });
    expect(text.some((t) => /^Página 1 de [2-9]$/.test(t))).toBe(true);
    expect(text.join("\n")).toContain("Viaje ? a Cartagena ? Bogotá");
  });

  it("borrador sale marcado; un logo PNG se incrusta y uno WebP se cambia por el nombre", async () => {
    const draft = await renderQuotePdf({ ...base, draft: true });
    expect(pdfText(draft.bytes)).toContain("BORRADOR");
    const withLogo = await renderQuotePdf({ ...base, logo: { bytes: tinyPng(200, 30, 30), type: "image/png" } });
    expect(Buffer.from(withLogo.bytes).toString("latin1")).toContain("/Subtype /Image");
    expect(withLogo.text[0]).not.toBe("Andes Travel");
    const webp = await renderQuotePdf({ ...base, logo: { bytes: new Uint8Array([82, 73, 70, 70]), type: "image/webp" } });
    expect(webp.text[0]).toBe("Andes Travel");
  });

  it("USD con 2 decimales", async () => {
    const { text } = await renderQuotePdf({ ...base, currency: "USD", items: [{ description: "Hotel", quantity: "3", unit: "noche", lineTotal: "30.02" }], total: "30.02" });
    expect(text.join(" ")).toMatch(/30,02 USD/);
  });
  it("prueba independiente: el encabezado de la tabla se repite en cada página y un nombre o correo largo se recorta", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ description: `Servicio ${i + 1}`, quantity: "1", unit: "servicio" as const, lineTotal: "1000" }));
    const longName = "Agencia de Viajes y Turismo Internacional Los Andes y el Caribe Colombiano SAS";
    const { text } = await renderQuotePdf({ ...base, items, agencyName: longName, advisorEmail: `${"asesora.con.un.correo.muy.largo".repeat(4)}@example.com` });
    const pages = text.filter((t) => /^Página \d+ de \d+$/.test(t)).length;
    expect(pages).toBeGreaterThan(1);
    expect(text.filter((t) => t === "SERVICIO")).toHaveLength(pages);
    expect(text.some((t) => t.endsWith("…") && t.startsWith("Agencia de Viajes"))).toBe(true);
    expect(text.some((t) => t.includes("Asesor:") && t.endsWith("…"))).toBe(true);
  });

  it("texto con tildes compuestas (NFD) sale con la letra, no con «?»", async () => {
    const { text } = await renderQuotePdf({ ...base, clientName: "Mari\u0301a Ibáñez" });
    expect(text.join("\n")).toContain("Para María Ibáñez");
  });
  it("prueba de Felipe F-01: con «solo total» o con precios, nada se sale de los márgenes (cantidad «2 personas» incluida)", async () => {
    const items = [
      { description: "Tiquetes Bogotá–Cartagena", quantity: "2", unit: "persona" as const, lineTotal: "1800000" },
      { description: "Hotel", quantity: "1234.5", unit: "noche" as const, lineTotal: "999999999999" },
    ];
    for (const showItemPrices of [false, true]) {
      const { boxes } = await renderQuotePdf({ ...base, items, total: "1001799999999", showItemPrices, agencyName: "Agencia de Viajes y Turismo Internacional Los Andes SAS" });
      expect(boxes.some((b) => b.text === "2 personas")).toBe(true);
      for (const b of boxes) {
        expect(b.x, `${b.text} empieza fuera`).toBeGreaterThanOrEqual(48 - 0.01);
        expect(b.x + b.width, `${b.text} se sale (${showItemPrices ? "con precios" : "solo total"})`).toBeLessThanOrEqual(595.28 - 48 + 0.01);
      }
      // Ninguna celda de la tabla pisa a la siguiente en la misma fila.
      const rows = new Map<string, typeof boxes>();
      for (const b of boxes) rows.set(`${b.page}:${b.y}`, [...(rows.get(`${b.page}:${b.y}`) ?? []), b]);
      for (const row of rows.values()) {
        const sorted = [...row].sort((a, z) => a.x - z.x);
        for (let k = 1; k < sorted.length; k++) expect(sorted[k - 1].x + sorted[k - 1].width, `${sorted[k - 1].text} pisa ${sorted[k].text}`).toBeLessThanOrEqual(sorted[k].x);
      }
    }
  });

});
