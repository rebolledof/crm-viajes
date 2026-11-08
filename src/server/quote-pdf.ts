// SPEC-004 parte 4 · PDF de la cotización (alcance 15). Solo recibe datos para el cliente: nunca
// coste, proveedor, utilidad, margen, tipo de cambio ni notas internas (RF-406). Con los mismos
// datos produce siempre los mismos bytes (fechas fijas), así que una versión enviada tiene un único PDF.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { Currency } from "@/domain/money";
import { formatAmount, formatDecimal, formatQuoteNumber, unitLabel, type QuoteUnit } from "@/domain/quotes";

export type QuotePdfData = {
  agencyName: string;
  primaryColor: string;
  logo: { bytes: Uint8Array; type: string } | null;
  number: number;
  version: number;
  /** Borrador: vista previa con la marca "BORRADOR"; no se guarda. */
  draft: boolean;
  /** Fecha de envío (o de la vista previa). */
  issuedAt: Date;
  validUntil: string | null;
  title: string;
  clientName: string;
  destination: string | null;
  travelStart: string | null;
  travelEnd: string | null;
  travelers: number | null;
  currency: Currency;
  showItemPrices: boolean;
  items: { description: string; quantity: string; unit: QuoteUnit; lineTotal: string }[];
  total: string;
  includes: string | null;
  excludes: string | null;
  paymentTerms: string | null;
  cancellationPolicy: string | null;
  advisorEmail: string | null;
};

const A4: [number, number] = [595.28, 841.89];
const M = 48; // margen
const fechaLarga = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
const dia = (iso: string) => fechaLarga.format(new Date(`${iso}T12:00:00-05:00`));

function hexColor(hex: string, fallback = "#0F6E6E"): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(hex) ?? /^#([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Las fuentes estándar solo tienen el alfabeto WinAnsi (español incluido); lo demás se cambia por "?". */
function safeText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ")) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Recorta con "…" para que quepa en el ancho. */
function fit(font: PDFFont, size: number, text: string, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) {
        line = tryLine;
        continue;
      }
      if (line) lines.push(line);
      // Palabra más ancha que la línea: se parte.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** Texto dibujado y su caja (en puntos), para comprobar en pruebas que nada se sale del margen. */
export type PdfBox = { text: string; page: number; x: number; y: number; width: number };

export async function renderQuotePdf(d: QuotePdfData): Promise<{ bytes: Uint8Array; text: string[]; boxes: PdfBox[] }> {
  const doc = await PDFDocument.create();
  const title = `Cotización N.º ${formatQuoteNumber(d.number)} · versión ${d.version}`;
  doc.setTitle(title);
  doc.setAuthor(d.agencyName);
  doc.setProducer("CRM Viajes");
  doc.setCreator("CRM Viajes");
  doc.setCreationDate(d.issuedAt);
  doc.setModificationDate(d.issuedAt);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const brand = hexColor(d.primaryColor);
  const ink = rgb(0.12, 0.16, 0.22);
  const muted = rgb(0.38, 0.42, 0.48);
  const line = rgb(0.85, 0.87, 0.9);
  const text: string[] = [];
  const boxes: PdfBox[] = [];
  let logo = null;
  if (d.logo) {
    // PNG y JPG se incrustan; un logo en WebP no se puede: va el nombre de la agencia.
    if (d.logo.type === "image/png") logo = await doc.embedPng(d.logo.bytes).catch(() => null);
    else if (d.logo.type === "image/jpeg") logo = await doc.embedJpg(d.logo.bytes).catch(() => null);
  }

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const width = A4[0] - 2 * M;
  const footerSpace = 56;

  /** Dibuja texto ya seguro en la página actual y lo anota. */
  const put = (t: string, x: number, size: number, font: PDFFont, color: RGB, p: PDFPage = page, at = y) => {
    p.drawText(t, { x, y: at, size, font, color });
    text.push(t);
    boxes.push({ text: t, page: pages.indexOf(p) + 1, x, y: at, width: font.widthOfTextAtSize(t, size) });
  };
  const draw = (s: string, x: number, size: number, font: PDFFont = regular, color: RGB = ink) => put(safeText(font, s), x, size, font, color);
  /** Alineado a la derecha: termina en `edge`. */
  const drawRight = (s: string, edge: number, size: number, font: PDFFont = regular, color: RGB = ink) => {
    const t = safeText(font, s);
    put(t, edge - font.widthOfTextAtSize(t, size), size, font, color);
  };
  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: brand });
    y = A4[1] - M;
    if (d.draft) {
      page.drawText("BORRADOR", { x: 110, y: 300, size: 84, font: bold, color: rgb(0.93, 0.93, 0.93), rotate: degrees(35) });
    }
  };
  const ensure = (h: number) => {
    if (y - h < M + footerSpace) newPage();
  };
  const paragraph = (s: string, size = 10, font: PDFFont = regular, color: RGB = ink, indent = 0) => {
    for (const l of wrap(font, size, safeText(font, s), width - indent)) {
      ensure(size + 4);
      y -= size + 4;
      draw(l, M + indent, size, font, color);
    }
  };

  newPage();
  // Encabezado: logo (o nombre) y datos del documento.
  const headTop = y;
  if (logo) {
    const scale = Math.min(140 / logo.width, 56 / logo.height, 1);
    page.drawImage(logo, { x: M, y: headTop - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
  } else {
    y = headTop - 18;
    // Nombre largo: letra más pequeña y, si aún no cabe, recortado; no pisa el número de la cotización.
    const nameWidth = width - 200;
    let size = 18;
    while (size > 11 && bold.widthOfTextAtSize(safeText(bold, d.agencyName), size) > nameWidth) size--;
    draw(fit(bold, size, safeText(bold, d.agencyName), nameWidth), M, size, bold, brand);
  }
  y = headTop - 12;
  const right = (s: string, size: number, font: PDFFont = regular, color: RGB = ink) => drawRight(s, A4[0] - M, size, font, color);
  right(`Cotización N.º ${formatQuoteNumber(d.number)}`, 12, bold);
  y -= 15;
  right(`Versión ${d.version} · ${fechaLarga.format(d.issuedAt)}`, 9, regular, muted);
  if (d.validUntil) {
    y -= 13;
    right(`Válida hasta el ${dia(d.validUntil)}`, 9, bold, brand);
  }
  y = Math.min(y, headTop - 64) - 12;
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: line });

  // Cliente y viaje.
  y -= 8;
  paragraph(d.title, 16, bold);
  y -= 4;
  paragraph(`Para ${d.clientName}${d.destination ? ` · ${d.destination}` : ""}`, 11);
  const trip = [
    d.travelStart ? `Del ${dia(d.travelStart)}${d.travelEnd ? ` al ${dia(d.travelEnd)}` : ""}` : "Fechas por definir",
    d.travelers ? `${d.travelers} ${d.travelers === 1 ? "viajero" : "viajeros"}` : null,
  ].filter(Boolean).join(" · ");
  paragraph(trip, 10, regular, muted);

  // Servicios.
  y -= 14;
  ensure(40);
  // Con precios: SERVICIO | CANTIDAD | VALOR. Solo total: SERVICIO | CANTIDAD, con la cantidad
  // alineada a la derecha de la tabla (antes empezaba en el margen y se salía del papel).
  const tableRight = A4[0] - M - 6;
  const qtyWidth = 100;
  const colQty = d.showItemPrices ? tableRight - 100 - qtyWidth : tableRight - qtyWidth;
  const descWidth = colQty - M - 16;
  const qtyText = (s: string) => fit(regular, 10, safeText(regular, s), qtyWidth);
  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 20, width, height: 20, color: rgb(0.95, 0.96, 0.97) });
    y -= 14;
    draw("SERVICIO", M + 6, 8, bold, muted);
    if (d.showItemPrices) {
      draw("CANTIDAD", colQty, 8, bold, muted);
      drawRight("VALOR", tableRight, 8, bold, muted);
    } else {
      drawRight("CANTIDAD", tableRight, 8, bold, muted);
    }
    y -= 10;
  };
  tableHeader();
  for (const it of d.items) {
    const lines = wrap(regular, 10, safeText(regular, it.description), descWidth);
    // En una página nueva se repite el encabezado de la tabla.
    if (y - (lines.length * 14 + 8) < M + footerSpace) {
      newPage();
      tableHeader();
    }
    const top = y;
    lines.forEach((l, i) => {
      y = top - 14 * (i + 1);
      draw(l, M + 6, 10);
    });
    y = top - 14;
    const qty = qtyText(unitLabel(it.unit, it.quantity, formatDecimal));
    if (d.showItemPrices) {
      put(qty, colQty, 10, regular, ink);
      drawRight(formatAmount(it.lineTotal, d.currency), tableRight, 10);
    } else {
      put(qty, tableRight - regular.widthOfTextAtSize(qty, 10), 10, regular, ink);
    }
    y = top - 14 * lines.length - 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.5, color: line });
  }
  ensure(34);
  y -= 22;
  draw("Total", M + 6, 13, bold);
  drawRight(formatAmount(d.total, d.currency), tableRight, 13, bold, brand);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1.5, color: brand });

  // Condiciones.
  for (const [label, body] of [
    ["Incluye", d.includes],
    ["No incluye", d.excludes],
    ["Forma de pago", d.paymentTerms],
    ["Política de cancelación", d.cancellationPolicy],
  ] as const) {
    if (!body?.trim()) continue;
    y -= 10;
    ensure(40);
    paragraph(label, 11, bold, brand);
    paragraph(body.trim(), 10);
  }

  // Pie en cada página: agencia, asesor y número de página.
  pages.forEach((p, i) => {
    const n = `Página ${i + 1} de ${pages.length}`;
    const foot = fit(regular, 8, safeText(regular, [d.agencyName, d.advisorEmail ? `Asesor: ${d.advisorEmail}` : null].filter(Boolean).join(" · ")), width - regular.widthOfTextAtSize(n, 8) - 16);
    p.drawLine({ start: { x: M, y: M + 18 }, end: { x: A4[0] - M, y: M + 18 }, thickness: 0.5, color: line });
    put(foot, M, 8, regular, muted, p, M);
    put(n, A4[0] - M - regular.widthOfTextAtSize(n, 8), 8, regular, muted, p, M);
  });

  return { bytes: await doc.save(), text, boxes };
}
