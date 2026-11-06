// SPEC-004 parte 1 · Cotizador contra PostgreSQL real: numeración, cálculo en la base, versiones
// inmutables, marca congelada, costes ocultos para Lectura, aislamiento entre agencias y catálogo.
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../../src/db/client";
import { auditEvents, catalogServices, quoteItems, quoteVersionCosts, quoteVersions, quotes } from "../../src/db/schema";
import { addDays, colombiaToday, quoteTotals } from "../../src/domain/quotes";
import { acceptInvitation, createAgency, createInvitation } from "../../src/server/agencies";
import { createContact } from "../../src/server/contacts";
import { AppError } from "../../src/server/errors";
import { createOpportunity, moveOpportunity, updateStage } from "../../src/server/opportunities";
import { describeAudit } from "../../src/domain/audit";
import { createNextVersion, createQuote, decideQuoteVersion, expiringQuotes, getSendPlan, sendQuoteVersion, getQuoteScreen, getQuoteSettings, getQuoteVersion, listCatalog, listOpportunityQuotes, saveCatalogService, saveDraft, saveDraftPart, updateQuoteSettings, type DraftInput } from "../../src/server/quotes";
import { as, createUser, testDb } from "./helpers";

const t = testDb();
let adminA: SessionUser, asesorA: SessionUser, lecturaA: SessionUser, adminB: SessionUser;
let agencyA: string, agencyB: string, oppA: string, oppB: string;
const now = () => new Date();

async function join(by: SessionUser, agencyId: string, who: SessionUser, role: "admin" | "asesor" | "lectura") {
  const inv = await as(t.db, by, (tx) => createInvitation(tx, { userId: by.id, agencyId, email: who.email, role, now: new Date() }));
  await as(t.db, who, (tx) => acceptInvitation(tx, inv.token));
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

/** Error crudo de la base (P0001 con el código como mensaje, o 42501 sin permiso). */
async function expectDb(p: Promise<unknown>, message: string | RegExp) {
  await expect(p).rejects.toSatisfy((e: unknown) => {
    let x: unknown = e;
    for (let i = 0; i < 3 && x; i++) {
      const m = (x as { message?: string }).message ?? "";
      if (typeof message === "string" ? m === message : message.test(m)) return true;
      x = (x as { cause?: unknown }).cause;
    }
    return false;
  });
}

// Ejemplo de la propuesta: Cartagena, 4 noches, en COP con un hotel cobrado en dólares.
const cartagena: DraftInput = {
  title: "Cartagena, 4 noches para 2 adultos",
  clientName: "Laura Pineda",
  destination: "Cartagena",
  travelStart: "2027-01-12",
  travelEnd: "2027-01-16",
  travelers: "2",
  saleCurrency: "COP",
  exchangeRate: "4.000",
  includes: "Desayuno diario",
  validUntil: addDays(colombiaToday(new Date()), 5),
  showItemPrices: true,
  items: [
    { description: "Hotel 4 noches, habitación doble", supplier: "Hotel del ejemplo", quantity: "4", unit: "noche", unitPrice: "750.000", unitCost: "150", costCurrency: "USD" },
    { description: "Vuelo Bogotá–Cartagena", supplier: "Aerolínea del ejemplo", quantity: "2", unit: "persona", unitPrice: "900.000", unitCost: "800.000", costCurrency: "COP" },
    { description: "Traslado", quantity: "1", unit: "servicio", unitPrice: "180.000", unitCost: "120.000", costCurrency: "COP" },
    { description: "Seguro de viaje", quantity: "2", unit: "persona", unitPrice: "60.000", unitCost: "55.000", costCurrency: "COP" },
  ],
};

async function newDraft(user: SessionUser = asesorA, agencyId = agencyA, opp = oppA, draft: DraftInput = cartagena) {
  const q = await as(t.db, user, (tx) => createQuote(tx, user.id, agencyId, { opportunityId: opp, now: now() }));
  await as(t.db, user, (tx) => saveDraft(tx, user.id, agencyId, q.versionId, draft));
  return q;
}

/** Envía tal como lo hará la parte 3: el estado pasa a enviada y la base congela la versión. */
function send(user: SessionUser, versionId: string) {
  return as(t.db, user, (tx) => tx.update(quoteVersions).set({ status: "enviada" }).where(eq(quoteVersions.id, versionId)));
}

beforeAll(async () => {
  adminA = await createUser(t.admin, "admin-cot-a");
  asesorA = await createUser(t.admin, "asesor-cot-a");
  lecturaA = await createUser(t.admin, "lectura-cot-a");
  adminB = await createUser(t.admin, "admin-cot-b");
  agencyA = await as(t.db, adminA, (tx) => createAgency(tx, "Andes Cotizador"));
  agencyB = await as(t.db, adminB, (tx) => createAgency(tx, "Caribe Cotizador"));
  await join(adminA, agencyA, asesorA, "asesor");
  await join(adminA, agencyA, lecturaA, "lectura");
  const cA = await as(t.db, asesorA, (tx) => createContact(tx, asesorA.id, agencyA, { fullName: "Laura Pineda", phones: [{ raw: "+57 300 111 2233" }], emails: [] }));
  oppA = await as(t.db, asesorA, (tx) => createOpportunity(tx, asesorA.id, agencyA, { contactId: cA, destination: "Cartagena", travelStart: "2027-01-12", travelEnd: "2027-01-16", travelers: 2 }));
  const cB = await as(t.db, adminB, (tx) => createContact(tx, adminB.id, agencyB, { fullName: "Carlos B", phones: [], emails: [] }));
  oppB = await as(t.db, adminB, (tx) => createOpportunity(tx, adminB.id, agencyB, { contactId: cB, destination: "San Andrés" }));
});

afterAll(() => t.close());

describe("crear y numerar (alcance 1 y 2, RF-411)", () => {
  it("la versión 1 nace en borrador con los datos de la oportunidad y la vigencia por defecto", async () => {
    const q = await as(t.db, asesorA, (tx) => createQuote(tx, asesorA.id, agencyA, { opportunityId: oppA, now: new Date("2026-12-14T15:00:00Z") }));
    const v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    expect(v.version).toMatchObject({ version: 1, status: "borrador", clientName: "Laura Pineda", destination: "Cartagena", title: "Cartagena", travelStart: "2027-01-12", travelers: 2, saleCurrency: "COP", validUntil: "2026-12-19" });
    expect(v.items).toEqual([]);
  });

  it("números consecutivos por agencia, independientes entre agencias", async () => {
    const a1 = await newDraft();
    const a2 = await newDraft();
    const b1 = await newDraft(adminB, agencyB, oppB);
    expect(a2.number).toBe(a1.number + 1);
    expect(b1.number).toBe(1);
  });

  it("AC-412: dos asesores a la vez reciben números distintos y consecutivos", async () => {
    const [x, y] = await Promise.all([
      as(t.db, asesorA, (tx) => createQuote(tx, asesorA.id, agencyA, { opportunityId: oppA, now: now() })),
      as(t.db, adminA, (tx) => createQuote(tx, adminA.id, agencyA, { opportunityId: oppA, now: now() })),
    ]);
    expect(Math.abs(x.number - y.number)).toBe(1);
  });

  it("el número que mande el cliente se ignora", async () => {
    const [row] = await as(t.db, asesorA, (tx) => tx.insert(quotes).values({ agencyId: agencyA, opportunityId: oppA, createdBy: asesorA.id, number: 9999 }).returning());
    expect(row.number).not.toBe(9999);
  });

  it("crear queda en la auditoría", async () => {
    const q = await newDraft();
    const rows = await t.admin`select action from audit_events where object_id = ${q.quoteId}`;
    expect(rows.map((r) => r.action)).toContain("quote.created");
  });
});

describe("cálculo en la base (RF-401 a RF-403)", () => {
  it("los totales que guarda la base coinciden con las reglas del dominio", async () => {
    const q = await newDraft();
    const v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    if (!v.canSeeCosts) throw new Error("el asesor debe ver costes");
    expect(v.items.map((i) => [i.lineTotal, i.lineCost])).toEqual([
      ["3000000.00", "2400000.00"],
      ["1800000.00", "1600000.00"],
      ["180000.00", "120000.00"],
      ["120000.00", "110000.00"],
    ]);
    const domain = quoteTotals(
      cartagena.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice.replace(/\./g, ""), unitCost: i.unitCost!.replace(/\./g, ""), costCurrency: i.costCurrency as "COP" | "USD" })),
      "COP",
      "4000",
    );
    expect(Number(v.saleTotal)).toBe(Number(domain.sale));
    expect(v.totals).toMatchObject({ sale: "5100000", cost: "4230000", profit: "870000" });
    expect(v.items.map((i) => i.lowMargin)).toEqual([false, false, false, true]);
    expect(v.minMarginPct).toBe("10.00");
  });

  it("AC-402 y AC-403 en la base: 3 × 10,005 USD = 30,02 y 1.000.000,5 COP = 1.000.001", async () => {
    const q = await newDraft(asesorA, agencyA, oppA, {
      ...cartagena,
      saleCurrency: "USD",
      exchangeRate: null,
      items: [{ description: "Tour", quantity: "3", unit: "persona", unitPrice: "10,005", unitCost: "0", costCurrency: "USD" }],
    });
    const [usd] = await t.admin`select line_total::text from quote_items where quote_version_id = ${q.versionId}`;
    expect(usd.line_total).toBe("30.02");
    const c = await newDraft(asesorA, agencyA, oppA, {
      ...cartagena,
      exchangeRate: null,
      items: [{ description: "Paquete", quantity: "1", unit: "servicio", unitPrice: "1000000,5", unitCost: "0", costCurrency: "COP" }],
    });
    const [cop] = await t.admin`select line_total::text from quote_items where quote_version_id = ${c.versionId}`;
    expect(cop.line_total).toBe("1000001.00");
  });

  it("los totales que mande el cliente se ignoran", async () => {
    const q = await newDraft();
    await as(t.db, asesorA, (tx) => tx.insert(quoteItems).values({ agencyId: agencyA, quoteVersionId: q.versionId, position: 9, description: "Truco", quantity: "1", unitPrice: "100", costCurrency: "COP", lineTotal: "1", lineCost: "999" }));
    const [row] = await t.admin`select line_total::text, line_cost::text from quote_items where quote_version_id = ${q.versionId} and position = 9`;
    expect(row).toEqual({ line_total: "100.00", line_cost: "0.00" });
  });

  it("sin tipo de cambio el coste en dólares queda pendiente; al escribirlo se recalcula", async () => {
    const q = await newDraft(asesorA, agencyA, oppA, { ...cartagena, exchangeRate: "" });
    let v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    if (!v.canSeeCosts) throw new Error("costes");
    expect(v.missingRate).toBe(true);
    expect(v.items[0].lineCost).toBeNull();
    await as(t.db, asesorA, (tx) => tx.update(quoteVersionCosts).set({ exchangeRate: "3900" }).where(eq(quoteVersionCosts.quoteVersionId, q.versionId)));
    v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    if (!v.canSeeCosts) throw new Error("costes");
    expect(v.items[0].lineCost).toBe("2340000.00");
    expect(v.missingRate).toBe(false);
  });
});

describe("enviar y congelar (RF-403, RF-404)", () => {
  it("AC-404: sin tipo de cambio no se puede enviar", async () => {
    const q = await newDraft(asesorA, agencyA, oppA, { ...cartagena, exchangeRate: "" });
    await expectDb(send(asesorA, q.versionId), "exchange_rate_required");
  });

  it("sin servicios o con vigencia vencida no se puede enviar", async () => {
    const empty = await as(t.db, asesorA, (tx) => createQuote(tx, asesorA.id, agencyA, { opportunityId: oppA, now: now() }));
    await expectDb(send(asesorA, empty.versionId), "quote_no_items");
    const past = await newDraft();
    await t.admin`update quote_versions set valid_until = current_date - 2 where id = ${past.versionId}`;
    await expectDb(send(asesorA, past.versionId), "valid_until_past");
  });

  it("al enviar guarda el total, quién la envió, el margen mínimo y la marca de ese momento", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    const [v] = await t.admin`select v.status, v.sale_total::text, v.sent_by, c.min_margin_pct::text, v.brand
      from quote_versions v join quote_version_costs c on c.quote_version_id = v.id where v.id = ${q.versionId}`;
    expect(v).toMatchObject({ status: "enviada", sale_total: "5100000.00", sent_by: asesorA.id, min_margin_pct: "10.00" });
    expect(v.brand).toMatchObject({ name: "Andes Cotizador", primary_color: "#0F6E6E" });
  });

  it("AC-407: cambiar la marca después no cambia lo enviado; la versión nueva usa la nueva", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    await t.admin`insert into agency_branding (agency_id, primary_color, accent_color, logo, logo_type, updated_by)
      values (${agencyA}, '#C2185B', '#FFB300', '\\x89504e47'::bytea, 'image/png', ${adminA.id})
      on conflict (agency_id) do update set primary_color = excluded.primary_color, logo = excluded.logo, logo_type = excluded.logo_type`;
    const next = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    await send(asesorA, next.versionId);
    const rows = await t.admin`select version, brand ->> 'primary_color' as color, brand_logo is not null as has_logo from quote_versions where quote_id = ${q.quoteId} order by version`;
    expect(rows.map((r) => [r.version, r.color, r.has_logo])).toEqual([[1, "#0F6E6E", false], [2, "#C2185B", true]]);
    await t.admin`delete from agency_branding where agency_id = ${agencyA}`;
  });
});

describe("versiones inmutables (RF-405, RF-413, AC-405, AC-406, AC-414)", () => {
  it("AC-405: la versión 2 cambia el hotel y la 1 queda igual y sustituida", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    const before = await t.admin`select description, unit_price::text, line_total::text from quote_items where quote_version_id = ${q.versionId} order by position`;
    const next = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    expect(next.created).toBe(true);
    const items = cartagena.items.map((i, n) => (n === 0 ? { ...i, description: "Hotel en Bocagrande", unitPrice: "625.000" } : i));
    await as(t.db, asesorA, (tx) => saveDraft(tx, asesorA.id, agencyA, next.versionId, { ...cartagena, items }));
    await send(asesorA, next.versionId);
    const versions = await t.admin`select version, status, sale_total::text from quote_versions where quote_id = ${q.quoteId} order by version`;
    expect(versions.map((v) => [v.version, v.status, v.sale_total])).toEqual([
      [1, "sustituida", "5100000.00"],
      [2, "enviada", "4600000.00"],
    ]);
    const after = await t.admin`select description, unit_price::text, line_total::text from quote_items where quote_version_id = ${q.versionId} order by position`;
    expect(after).toEqual(before);
  });

  it("AC-406: una versión enviada no cambia ni llamando directo a la base", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    await expectCode(as(t.db, asesorA, (tx) => saveDraft(tx, asesorA.id, agencyA, q.versionId, cartagena)), "quote_version_locked");
    await expectDb(as(t.db, asesorA, (tx) => tx.update(quoteVersions).set({ title: "Otro" }).where(eq(quoteVersions.id, q.versionId))), "quote_version_locked");
    await expectDb(as(t.db, asesorA, (tx) => tx.update(quoteItems).set({ unitPrice: "1" }).where(eq(quoteItems.quoteVersionId, q.versionId))), "quote_version_locked");
    await expectDb(as(t.db, asesorA, (tx) => tx.delete(quoteItems).where(eq(quoteItems.quoteVersionId, q.versionId))), "quote_version_locked");
    await expectDb(as(t.db, asesorA, (tx) => tx.insert(quoteItems).values({ agencyId: agencyA, quoteVersionId: q.versionId, position: 5, description: "Extra", quantity: "1", unitPrice: "1", costCurrency: "COP" })), "quote_version_locked");
    // Ni siquiera el dueño de la base (sin RLS) la cambia: la regla está en el trigger.
    await expectDb(t.admin`update quote_versions set sale_total = 1 where id = ${q.versionId}`, "quote_version_locked");
    await expectDb(t.admin`update quote_items set unit_price = 1 where quote_version_id = ${q.versionId}`, "quote_version_locked");
    await expectDb(t.admin`delete from quote_versions where id = ${q.versionId}`, "quote_version_locked");
    const [v] = await t.admin`select sale_total::text from quote_versions where id = ${q.versionId}`;
    expect(v.sale_total).toBe("5100000.00");
  });

  it("los estados solo avanzan: enviada → aceptada; nada después", async () => {
    const q = await newDraft();
    await expectDb(as(t.db, asesorA, (tx) => tx.update(quoteVersions).set({ status: "aceptada" }).where(eq(quoteVersions.id, q.versionId))), "invalid_quote_transition");
    await send(asesorA, q.versionId);
    await as(t.db, asesorA, (tx) => tx.update(quoteVersions).set({ status: "aceptada" }).where(eq(quoteVersions.id, q.versionId)));
    const [v] = await t.admin`select status, decided_by from quote_versions where id = ${q.versionId}`;
    expect(v).toEqual({ status: "aceptada", decided_by: asesorA.id });
    await expectDb(as(t.db, asesorA, (tx) => tx.update(quoteVersions).set({ status: "rechazada" }).where(eq(quoteVersions.id, q.versionId))), "invalid_quote_transition");
  });

  it("AC-414: con un borrador abierto, crear versión lleva al borrador existente", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    const first = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    const again = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    expect(again).toEqual({ versionId: first.versionId, created: false });
    // Y la base tampoco deja dos borradores aunque se salte la aplicación.
    await expect(as(t.db, asesorA, (tx) => tx.insert(quoteVersions).values({ agencyId: agencyA, quoteId: q.quoteId, title: "x", clientName: "x", createdBy: asesorA.id }))).rejects.toThrow();
  });

  it("la versión 3 se puede crear a partir de la 1", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    const v2 = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    await as(t.db, asesorA, (tx) => saveDraft(tx, asesorA.id, agencyA, v2.versionId, { ...cartagena, items: cartagena.items.slice(0, 1) }));
    await send(asesorA, v2.versionId);
    const v3 = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    const items = await t.admin`select count(*)::int as n from quote_items where quote_version_id = ${v3.versionId}`;
    expect(items[0].n).toBe(4);
    const audit = await as(t.db, adminA, (tx) => tx.select({ action: auditEvents.action, changes: auditEvents.changes }).from(auditEvents).where(and(eq(auditEvents.objectId, q.quoteId), eq(auditEvents.action, "quote.version_created"))));
    expect(audit.map((a) => a.changes)).toEqual(expect.arrayContaining([{ version: 3, desde: 1 }]));
  });

  it("la ficha lista la versión vigente, el borrador y el historial", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    const list = await as(t.db, lecturaA, (tx) => listOpportunityQuotes(tx, lecturaA.id, agencyA, oppA, now()));
    const mine = list.find((x) => x.id === q.quoteId)!;
    expect(mine.current).toMatchObject({ version: 1, status: "enviada", saleTotal: "5100000.00" });
    expect(mine.draft).toMatchObject({ version: 2, status: "borrador" });
    expect(mine.history.map((h) => h.version)).toEqual([2, 1]);
  });
});

describe("Lectura no ve costes (RF-406, AC-410)", () => {
  it("ve precios de venta y totales, sin coste, utilidad ni margen", async () => {
    const q = await newDraft();
    const v = await as(t.db, lecturaA, (tx) => getQuoteVersion(tx, lecturaA.id, agencyA, q.versionId, now()));
    expect(v.canSeeCosts).toBe(false);
    expect(v.saleTotal).toBe("5100000");
    expect(v.items[0]).toEqual({ id: expect.any(String), position: 0, description: "Hotel 4 noches, habitación doble", quantity: "4.00", unit: "noche", unitPrice: "750000.0000", lineTotal: "3000000.00" });
    expect(JSON.stringify(v)).not.toMatch(/unitCost|lineCost|2400000|margin|Margin|profit|exchange|4000/);
  });

  it("tampoco llamando directo a la base", async () => {
    const q = await newDraft();
    const rows = await as(t.db, lecturaA, (tx) => tx.select().from(quoteItems).where(eq(quoteItems.quoteVersionId, q.versionId)));
    expect(rows).toEqual([]);
    const cat = await as(t.db, lecturaA, (tx) => tx.select().from(catalogServices));
    expect(cat).toEqual([]);
    // Hallazgo M1 de QA: el tipo de cambio y el margen mínimo tampoco.
    const costs = await as(t.db, lecturaA, (tx) => tx.select().from(quoteVersionCosts).where(eq(quoteVersionCosts.quoteVersionId, q.versionId)));
    expect(costs).toEqual([]);
    const cols = await t.admin`select column_name from information_schema.columns where table_name = 'quote_versions'`;
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(["exchange_rate"]));
  });

  it("no crea, no edita y no envía", async () => {
    const q = await newDraft();
    await expectCode(as(t.db, lecturaA, (tx) => createQuote(tx, lecturaA.id, agencyA, { opportunityId: oppA, now: now() })), "permission_denied");
    await expectCode(as(t.db, lecturaA, (tx) => saveDraft(tx, lecturaA.id, agencyA, q.versionId, cartagena)), "permission_denied");
    await expectCode(as(t.db, lecturaA, (tx) => createNextVersion(tx, lecturaA.id, agencyA, q.versionId)), "permission_denied");
    const upd = await as(t.db, lecturaA, (tx) => tx.update(quoteVersions).set({ status: "enviada" }).where(eq(quoteVersions.id, q.versionId)).returning());
    expect(upd).toEqual([]);
    await expect(as(t.db, lecturaA, (tx) => tx.insert(quotes).values({ agencyId: agencyA, opportunityId: oppA, createdBy: lecturaA.id }))).rejects.toThrow();
  });
});

describe("aislamiento entre agencias (RF-400, AC-411)", () => {
  it("la agencia B no ve ni toca cotizaciones de A", async () => {
    const q = await newDraft();
    await expectCode(as(t.db, adminB, (tx) => getQuoteVersion(tx, adminB.id, agencyA, q.versionId, now())), "not_found");
    await expectCode(as(t.db, adminB, (tx) => getQuoteVersion(tx, adminB.id, agencyB, q.versionId, now())), "not_found");
    const v = await as(t.db, adminB, (tx) => tx.select().from(quoteVersions).where(eq(quoteVersions.id, q.versionId)));
    expect(v).toEqual([]);
    const items = await as(t.db, adminB, (tx) => tx.execute(sql`select * from app.quote_items_for_client(${q.versionId})`));
    expect([...items]).toEqual([]);
    const upd = await as(t.db, adminB, (tx) => tx.update(quoteItems).set({ unitPrice: "1" }).where(eq(quoteItems.quoteVersionId, q.versionId)).returning());
    expect(upd).toEqual([]);
  });

  it("no se puede cotizar sobre una oportunidad de otra agencia", async () => {
    await expectCode(as(t.db, adminB, (tx) => createQuote(tx, adminB.id, agencyB, { opportunityId: oppA, now: now() })), "not_found");
    await expect(as(t.db, adminB, (tx) => tx.insert(quotes).values({ agencyId: agencyB, opportunityId: oppA, createdBy: adminB.id }))).rejects.toThrow();
  });

  it("un ítem no puede colgar de una versión de otra agencia", async () => {
    const q = await newDraft();
    await expect(as(t.db, adminB, (tx) => tx.insert(quoteItems).values({ agencyId: agencyB, quoteVersionId: q.versionId, position: 0, description: "x", quantity: "1", unitPrice: "1", costCurrency: "COP" }))).rejects.toThrow();
  });
});

describe("catálogo simple (RF-412, AC-413)", () => {
  it("solo el administrador lo cambia; copiarlo a una cotización no la ata al catálogo", async () => {
    await expect(as(t.db, asesorA, (tx) => tx.insert(catalogServices).values({ agencyId: agencyA, description: "Traslado", unit: "servicio", unitCost: "120000", costCurrency: "COP", unitPrice: "180000", priceCurrency: "COP", createdBy: asesorA.id }))).rejects.toThrow();
    const [svc] = await as(t.db, adminA, (tx) => tx.insert(catalogServices).values({ agencyId: agencyA, description: "Traslado", unit: "servicio", unitCost: "120000", costCurrency: "COP", unitPrice: "180000", priceCurrency: "COP", createdBy: adminA.id }).returning());
    const seen = await as(t.db, asesorA, (tx) => tx.select().from(catalogServices).where(eq(catalogServices.id, svc.id)));
    expect(seen).toHaveLength(1);
    const q = await newDraft(asesorA, agencyA, oppA, { ...cartagena, items: [{ description: svc.description, quantity: "1", unit: svc.unit, unitPrice: "180000", unitCost: "120000", costCurrency: "COP", catalogServiceId: svc.id }] });
    await as(t.db, adminA, (tx) => tx.update(catalogServices).set({ unitPrice: "200000" }).where(eq(catalogServices.id, svc.id)));
    const [item] = await t.admin`select unit_price::text, line_total::text, catalog_service_id from quote_items where quote_version_id = ${q.versionId}`;
    expect(item).toEqual({ unit_price: "180000.0000", line_total: "180000.00", catalog_service_id: svc.id });
  });
});

describe("hallazgos de la prueba independiente (QA, 5 nov 2026)", () => {
  it("A1: un ítem no se cuela en una versión que se está enviando en otra transacción", async () => {
    const q = await newDraft();
    let release!: () => void;
    let sentInA!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const sending = new Promise<void>((r) => (sentInA = r));
    const a = as(t.db, asesorA, async (tx) => {
      await tx.update(quoteVersions).set({ status: "enviada" }).where(eq(quoteVersions.id, q.versionId));
      sentInA();
      await held;
    });
    await sending;
    let settled = false;
    const b = as(t.db, adminA, (tx) => tx.insert(quoteItems).values({ agencyId: agencyA, quoteVersionId: q.versionId, position: 7, description: "Colado", quantity: "1", unitPrice: "777", costCurrency: "COP" })).finally(() => (settled = true));
    b.catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false); // espera a que la otra transacción termine
    release();
    await a;
    await expectDb(b, "quote_version_locked");
    const [v] = await t.admin`select v.sale_total::text as total, (select sum(line_total)::text from quote_items i where i.quote_version_id = v.id) as items from quote_versions v where v.id = ${q.versionId}`;
    expect(v.total).toBe(v.items);
  });

  it("M2: un borrador con ítems se puede borrar si hay otra versión; la única versión no (B3)", async () => {
    const q = await newDraft();
    await expectDb(as(t.db, asesorA, (tx) => tx.delete(quoteVersions).where(eq(quoteVersions.id, q.versionId))), "quote_last_version");
    await send(asesorA, q.versionId);
    const next = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    const del = await as(t.db, asesorA, (tx) => tx.delete(quoteVersions).where(eq(quoteVersions.id, next.versionId)).returning({ id: quoteVersions.id }));
    expect(del).toHaveLength(1);
    const left = await t.admin`select count(*)::int as n from quote_items where quote_version_id = ${next.versionId}`;
    expect(left[0].n).toBe(0);
  });

  it("M3: un importe que no cabe se avisa en su campo, sin error técnico", async () => {
    const q = await as(t.db, asesorA, (tx) => createQuote(tx, asesorA.id, agencyA, { opportunityId: oppA, now: now() }));
    const huge = { ...cartagena, exchangeRate: "1.000.000", items: [{ description: "Grande", quantity: "9999", unit: "servicio", unitPrice: "999999999999", unitCost: "0", costCurrency: "COP" }] };
    await expect(as(t.db, asesorA, (tx) => saveDraft(tx, asesorA.id, agencyA, q.versionId, huge))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "amount_too_large" && e.field === "unitPrice.0");
    const cost = { ...huge, items: [{ description: "Coste", quantity: "9999", unit: "servicio", unitPrice: "1", unitCost: "999999", costCurrency: "USD" }] };
    await expect(as(t.db, asesorA, (tx) => saveDraft(tx, asesorA.id, agencyA, q.versionId, cost))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "amount_too_large" && e.field === "unitCost.0");
  });

  it("B1: nadie marca sustituida a mano una versión vigente", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    await expectDb(as(t.db, asesorA, (tx) => tx.update(quoteVersions).set({ status: "sustituida" }).where(eq(quoteVersions.id, q.versionId))), "invalid_quote_transition");
  });

  it("B2: un ítem no apunta a un servicio del catálogo que no existe o es de otra agencia", async () => {
    const q = await newDraft();
    const [svcB] = await as(t.db, adminB, (tx) => tx.insert(catalogServices).values({ agencyId: agencyB, description: "De B", unit: "servicio", costCurrency: "COP", priceCurrency: "COP", createdBy: adminB.id }).returning());
    const item = { ...cartagena.items[2], catalogServiceId: svcB.id };
    await expect(as(t.db, asesorA, (tx) => saveDraft(tx, asesorA.id, agencyA, q.versionId, { ...cartagena, items: [item] }))).rejects.toThrow();
  });

  it("B6: si otra persona crea el borrador al mismo tiempo, el mensaje lo dice", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    const results = await Promise.allSettled([
      as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId)),
      as(t.db, adminA, (tx) => createNextVersion(tx, adminA.id, agencyA, q.versionId)),
    ]);
    const drafts = await t.admin`select count(*)::int as n from quote_versions where quote_id = ${q.quoteId} and status = 'borrador'`;
    expect(drafts[0].n).toBe(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(AppError);
      if (r.status === "rejected") expect((r.reason as AppError).code).toBe("quote_draft_exists");
    }
  });
});

describe("parte 2: pantalla de 3 pasos, catálogo y ajustes", () => {
  const traslado = { description: "Traslado aeropuerto–hotel", supplier: "Operador local", unit: "servicio", unitCost: "120.000", costCurrency: "COP", unitPrice: "180.000", priceCurrency: "COP", active: true };

  it("guardar el paso 1 no borra las condiciones, y guardar el paso 2 no borra los servicios", async () => {
    const q = await newDraft();
    await as(t.db, asesorA, (tx) => saveDraftPart(tx, asesorA.id, agencyA, q.versionId, { saleCurrency: "COP", exchangeRate: "4.100", items: cartagena.items.slice(0, 2) }));
    let v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    expect(v.version.includes).toBe("Desayuno diario");
    expect(v.canSeeCosts && v.exchangeRate).toBe("4100.0000");
    expect(v.items).toHaveLength(2);
    expect(v.items[0].lineTotal).toBe("3000000.00");
    await as(t.db, asesorA, (tx) => saveDraftPart(tx, asesorA.id, agencyA, q.versionId, { title: "Cartagena en enero", includes: "Todo incluido", showItemPrices: false }));
    v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    expect(v.version).toMatchObject({ title: "Cartagena en enero", includes: "Todo incluido", showItemPrices: false, clientName: "Laura Pineda" });
    expect(v.items.map((i) => i.description)).toEqual(cartagena.items.slice(0, 2).map((i) => i.description));
    // El coste en USD sigue convertido con el tipo de cambio guardado en el paso 1 (4.100).
    expect(v.canSeeCosts && v.items[0].lineCost).toBe("2460000.00");
  });

  it("Lectura no guarda pasos y una enviada no se cambia por ningún paso", async () => {
    const q = await newDraft();
    await expectCode(as(t.db, lecturaA, (tx) => saveDraftPart(tx, lecturaA.id, agencyA, q.versionId, { title: "x" })), "permission_denied");
    await send(asesorA, q.versionId);
    await expectCode(as(t.db, asesorA, (tx) => saveDraftPart(tx, asesorA.id, agencyA, q.versionId, { title: "x" })), "quote_version_locked");
  });

  it("la pantalla trae la oportunidad y las versiones; para Lectura, sin costes ni tipo de cambio", async () => {
    const q = await newDraft();
    await send(asesorA, q.versionId);
    const next = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    const s = await as(t.db, asesorA, (tx) => getQuoteScreen(tx, asesorA.id, agencyA, next.versionId, now()));
    expect(s.opportunity).toMatchObject({ id: oppA, contactName: "Laura Pineda", destination: "Cartagena" });
    expect(s.versions.map((x) => [x.version, x.status])).toEqual([[2, "borrador"], [1, "enviada"]]);
    const l = await as(t.db, lecturaA, (tx) => getQuoteScreen(tx, lecturaA.id, agencyA, q.versionId, now()));
    expect(l.canSeeCosts).toBe(false);
    const json = JSON.stringify(l);
    expect(json).not.toMatch(/unitCost|lineCost|exchangeRate|minMargin|profit|4000/);
    await expectCode(as(t.db, adminB, (tx) => getQuoteScreen(tx, adminB.id, agencyB, q.versionId, now())), "not_found");
  });

  it("catálogo: el administrador lo crea y lo cambia; el asesor solo lo usa; Lectura ni lo ve", async () => {
    const id = await as(t.db, adminA, (tx) => saveCatalogService(tx, adminA.id, agencyA, null, traslado));
    const list = await as(t.db, asesorA, (tx) => listCatalog(tx, asesorA.id, agencyA));
    expect(list.find((c) => c.id === id)).toMatchObject({ unitCost: "120000.0000", unitPrice: "180000.0000" });
    await expectCode(as(t.db, asesorA, (tx) => saveCatalogService(tx, asesorA.id, agencyA, null, traslado)), "permission_denied");
    await expectCode(as(t.db, lecturaA, (tx) => listCatalog(tx, lecturaA.id, agencyA)), "permission_denied");
    // Desactivado ya no se ofrece al armar, pero sigue en la lista completa del administrador.
    await as(t.db, adminA, (tx) => saveCatalogService(tx, adminA.id, agencyA, id, { ...traslado, active: false }));
    expect((await as(t.db, asesorA, (tx) => listCatalog(tx, asesorA.id, agencyA))).some((c) => c.id === id)).toBe(false);
    expect((await as(t.db, adminA, (tx) => listCatalog(tx, adminA.id, agencyA, { includeInactive: true }))).some((c) => c.id === id)).toBe(true);
    // Otra agencia no lo ve ni lo cambia.
    expect((await as(t.db, adminB, (tx) => listCatalog(tx, adminB.id, agencyB, { includeInactive: true }))).some((c) => c.id === id)).toBe(false);
    await expectCode(as(t.db, adminB, (tx) => saveCatalogService(tx, adminB.id, agencyB, id, traslado)), "not_found");
    const audit = await t.admin`select action from audit_events where object_id = ${id} order by created_at`;
    expect(audit.map((a) => a.action)).toEqual(["catalog.created", "catalog.updated"]);
  });

  it("ajustes: se guardan dos veces (la segunda actualiza) y la cotización nueva los usa", async () => {
    await as(t.db, adminA, (tx) => updateQuoteSettings(tx, adminA.id, agencyA, { minMarginPct: "12", validityDays: "7", defaultPaymentTerms: "50 % al reservar" }));
    await as(t.db, adminA, (tx) => updateQuoteSettings(tx, adminA.id, agencyA, { minMarginPct: "12,5", validityDays: "8", defaultPaymentTerms: "50 % al reservar", defaultIncludes: "Desayuno" }));
    const s = await as(t.db, asesorA, (tx) => getQuoteSettings(tx, asesorA.id, agencyA));
    expect(s).toMatchObject({ minMarginPct: "12.50", validityDays: 8, defaultIncludes: "Desayuno", defaultPaymentTerms: "50 % al reservar" });
    const q = await as(t.db, asesorA, (tx) => createQuote(tx, asesorA.id, agencyA, { opportunityId: oppA, now: new Date("2026-12-14T15:00:00Z") }));
    const v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    expect(v.version).toMatchObject({ validUntil: "2026-12-22", includes: "Desayuno", paymentTerms: "50 % al reservar" });
    expect(v.canSeeCosts && v.minMarginPct).toBe("12.50");
    await expectCode(as(t.db, asesorA, (tx) => updateQuoteSettings(tx, asesorA.id, agencyA, { minMarginPct: "5", validityDays: "5" })), "permission_denied");
    await expect(as(t.db, adminA, (tx) => updateQuoteSettings(tx, adminA.id, agencyA, { minMarginPct: "95", validityDays: "5" }))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.field === "minMarginPct");
    // Volver a los valores por defecto para no afectar otras pruebas.
    await as(t.db, adminA, (tx) => updateQuoteSettings(tx, adminA.id, agencyA, { minMarginPct: "10", validityDays: "5" }));
  });
});

describe("parte 2: hallazgos de la prueba independiente (5 nov 2026)", () => {
  it("hallazgo 3: dos pestañas guardan pasos distintos a la vez y no se pisan", async () => {
    const q = await newDraft();
    const items = cartagena.items.slice(0, 1);
    await Promise.all([
      as(t.db, asesorA, (tx) => saveDraftPart(tx, asesorA.id, agencyA, q.versionId, { saleCurrency: "COP", exchangeRate: "4.000", items })),
      as(t.db, adminA, (tx) => saveDraftPart(tx, adminA.id, agencyA, q.versionId, { title: "Título desde otra pestaña" })),
    ]);
    const v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    expect(v.version.title).toBe("Título desde otra pestaña");
    expect(v.items.map((i) => i.description)).toEqual(items.map((i) => i.description));
  });

  it("AC-413: un servicio copiado del catálogo no cambia cuando el administrador cambia el catálogo", async () => {
    const id = await as(t.db, adminA, (tx) => saveCatalogService(tx, adminA.id, agencyA, null, { description: "Traslado del catálogo", unit: "servicio", unitCost: "120.000", costCurrency: "COP", unitPrice: "180.000", priceCurrency: "COP", active: true }));
    const q = await newDraft();
    await as(t.db, asesorA, (tx) => saveDraftPart(tx, asesorA.id, agencyA, q.versionId, { items: [{ description: "Traslado del catálogo", quantity: "1", unit: "servicio", unitPrice: "180.000", unitCost: "120.000", costCurrency: "COP", catalogServiceId: id }] }));
    await as(t.db, adminA, (tx) => saveCatalogService(tx, adminA.id, agencyA, id, { description: "Traslado del catálogo", unit: "servicio", unitCost: "150.000", costCurrency: "COP", unitPrice: "200.000", priceCurrency: "COP", active: true }));
    const v = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, q.versionId, now()));
    expect(v.items[0]).toMatchObject({ unitPrice: "180000.0000", lineTotal: "180000.00", catalogServiceId: id });
  });
});

describe("parte 3: enviar, aceptar y rechazar (alcance 10 a 14)", () => {
  let contact: string;
  const stage = async (agencyId: string, name: string) =>
    (await t.admin`select id from pipeline_stages where agency_id = ${agencyId} and name = ${name}`)[0].id as string;
  const stageOf = async (opp: string) =>
    (await t.admin`select s.name from opportunities o join pipeline_stages s on s.id = o.stage_id where o.id = ${opp}`)[0].name as string;
  async function oppIn(stageName: string, owner: SessionUser = asesorA) {
    const id = await as(t.db, owner, (tx) => createOpportunity(tx, owner.id, agencyA, { contactId: contact, destination: "Santa Marta", ownerId: owner.id }));
    const target = await stage(agencyA, stageName);
    await as(t.db, owner, (tx) => moveOpportunity(tx, owner.id, agencyA, id, { stageId: target }));
    return id;
  }

  beforeAll(async () => {
    contact = await as(t.db, asesorA, (tx) => createContact(tx, asesorA.id, agencyA, { fullName: "Marta Envío", phones: [{ raw: "+57 300 999 0001" }], emails: [] }));
  });

  it("AC-409: desde Calificado, enviar pasa la oportunidad a Propuesta enviada y arranca su seguimiento", async () => {
    const opp = await oppIn("Calificado");
    const q = await newDraft(asesorA, agencyA, opp);
    expect(await as(t.db, asesorA, (tx) => getSendPlan(tx, asesorA.id, agencyA, q.versionId))).toMatchObject({ willMove: true, reason: "mueve", stageName: "Calificado" });
    const r = await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId));
    expect(r).toEqual({ movedTo: "Propuesta enviada", sustituidas: 0 });
    expect(await stageOf(opp)).toBe("Propuesta enviada");
    const followups = await t.admin`select t.title from tasks t join pipeline_stages s on s.id = t.trigger_stage_id where t.opportunity_id = ${opp} and s.name = 'Propuesta enviada' and t.status = 'abierta'`;
    expect(followups.map((f) => f.title)).toContain("Confirmar que revisó la propuesta");
    const [v] = await t.admin`select status::text, sale_total::text, sent_by from quote_versions where id = ${q.versionId}`;
    expect(v).toMatchObject({ status: "enviada", sale_total: "5100000.00", sent_by: asesorA.id });
  });

  it("AC-409: desde Negociación, enviar una versión nueva no la retrocede; la anterior queda Sustituida", async () => {
    const opp = await oppIn("Negociación");
    const q = await newDraft(asesorA, agencyA, opp);
    expect((await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId))).movedTo).toBeNull();
    const v2 = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q.versionId));
    expect(await as(t.db, asesorA, (tx) => getSendPlan(tx, asesorA.id, agencyA, v2.versionId))).toMatchObject({ willMove: false, reason: "ya_despues" });
    expect(await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, v2.versionId))).toEqual({ movedTo: null, sustituidas: 1 });
    expect(await stageOf(opp)).toBe("Negociación");
    const [v1] = await t.admin`select status::text from quote_versions where id = ${q.versionId}`;
    expect(v1.status).toBe("sustituida");
  });

  it("una oportunidad cerrada no cambia de etapa; sin etapa «Propuesta enviada» tampoco", async () => {
    const opp = await oppIn("Calificado");
    const lost = await stage(agencyA, "Perdido");
    await as(t.db, asesorA, (tx) => moveOpportunity(tx, asesorA.id, agencyA, opp, { stageId: lost, lostReason: "precio" }));
    const q = await newDraft(asesorA, agencyA, opp);
    expect(await as(t.db, asesorA, (tx) => getSendPlan(tx, asesorA.id, agencyA, q.versionId))).toMatchObject({ willMove: false, reason: "cerrada" });
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId));
    expect(await stageOf(opp)).toBe("Perdido");
    // Agencia B renombra la etapa: no se adivina cuál es; la oportunidad se queda.
    const propB = await stage(agencyB, "Propuesta enviada");
    await as(t.db, adminB, (tx) => updateStage(tx, adminB.id, agencyB, propB, { name: "Cotización enviada" }));
    const qB = await newDraft(adminB, agencyB, oppB);
    expect(await as(t.db, adminB, (tx) => getSendPlan(tx, adminB.id, agencyB, qB.versionId))).toMatchObject({ willMove: false, reason: "sin_etapa" });
    expect((await as(t.db, adminB, (tx) => sendQuoteVersion(tx, adminB.id, agencyB, qB.versionId))).movedTo).toBeNull();
    await as(t.db, adminB, (tx) => updateStage(tx, adminB.id, agencyB, propB, { name: "Propuesta enviada" }));
  });

  it("AC-404 y AC-408: sin tipo de cambio se rechaza en su campo; con margen bajo se envía igual", async () => {
    const opp = await oppIn("Calificado");
    const q = await newDraft(asesorA, agencyA, opp, { ...cartagena, exchangeRate: "" });
    await expect(as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "exchange_rate_required");
    const [still] = await t.admin`select status::text from quote_versions where id = ${q.versionId}`;
    expect(still.status).toBe("borrador");
    expect(await stageOf(opp)).toBe("Calificado");
    const low = await newDraft(asesorA, agencyA, opp, { ...cartagena, items: [{ description: "Seguro", quantity: "1", unit: "persona", unitPrice: "60.000", unitCost: "55.000", costCurrency: "COP" }] });
    const lowV = await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, low.versionId, now()));
    expect(lowV.canSeeCosts && lowV.lowMarginTotal).toBe(true);
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, low.versionId));
    expect((await t.admin`select status::text from quote_versions where id = ${low.versionId}`)[0].status).toBe("enviada");
  });

  it("enviar dos veces la misma versión se rechaza sin tocar nada", async () => {
    const q = await newDraft(asesorA, agencyA, await oppIn("Calificado"));
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId));
    await expectCode(as(t.db, adminA, (tx) => sendQuoteVersion(tx, adminA.id, agencyA, q.versionId)), "quote_already_sent");
  });

  it("AC-415: aceptar queda con quién y cuándo; la auditoría dice quién creó, envió y marcó aceptada", async () => {
    const q = await newDraft(asesorA, agencyA, await oppIn("Calificado"));
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId));
    await as(t.db, adminA, (tx) => decideQuoteVersion(tx, adminA.id, agencyA, q.versionId, "aceptada"));
    const [v] = await t.admin`select status::text, decided_by from quote_versions where id = ${q.versionId}`;
    expect(v).toEqual({ status: "aceptada", decided_by: adminA.id });
    const events = await t.admin`select action, actor_id, changes from audit_events where object_id = ${q.quoteId} order by created_at`;
    expect(events.map((e) => [e.action, e.actor_id])).toEqual([
      ["quote.created", asesorA.id],
      ["quote.sent", asesorA.id],
      ["quote.accepted", adminA.id],
    ]);
    const accepted = events[2];
    expect(describeAudit({ action: accepted.action, changes: accepted.changes } as never).text).toBe(`Marcó aceptada la versión 1 de la cotización N.º ${String(q.number).padStart(4, "0")}`);
    expect(describeAudit({ action: "quote.sent", changes: events[1].changes } as never).details).toContain("Total: 5.100.000 COP");
    // Ya decidida: ni aceptar otra vez ni rechazar.
    // Otra persona con la ventana abierta: el mensaje dice que ya la marcaron, no un error genérico.
    await expectCode(as(t.db, asesorA, (tx) => decideQuoteVersion(tx, asesorA.id, agencyA, q.versionId, "rechazada")), "quote_already_decided");
    await expectCode(as(t.db, asesorA, (tx) => decideQuoteVersion(tx, asesorA.id, agencyA, q.versionId, "aceptada")), "quote_already_decided");
  });

  it("rechazar; un borrador no se acepta; solo una versión aceptada por cotización", async () => {
    const q = await newDraft(asesorA, agencyA, await oppIn("Calificado"));
    await expectCode(as(t.db, asesorA, (tx) => decideQuoteVersion(tx, asesorA.id, agencyA, q.versionId, "aceptada")), "invalid_quote_transition");
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId));
    await as(t.db, asesorA, (tx) => decideQuoteVersion(tx, asesorA.id, agencyA, q.versionId, "rechazada"));
    expect((await t.admin`select status::text from quote_versions where id = ${q.versionId}`)[0].status).toBe("rechazada");
    // Otra cotización de la misma oportunidad: v1 aceptada; luego v2 enviada no puede quedar aceptada también.
    const q2 = await newDraft(asesorA, agencyA, await oppIn("Calificado"));
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q2.versionId));
    await as(t.db, asesorA, (tx) => decideQuoteVersion(tx, asesorA.id, agencyA, q2.versionId, "aceptada"));
    const v2 = await as(t.db, asesorA, (tx) => createNextVersion(tx, asesorA.id, agencyA, q2.versionId));
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, v2.versionId));
    await expectCode(as(t.db, asesorA, (tx) => decideQuoteVersion(tx, asesorA.id, agencyA, v2.versionId, "aceptada")), "quote_already_accepted");
  });

  it("AC-410 y AC-411: Lectura no envía ni decide; otra agencia recibe «no encontrado»", async () => {
    const q = await newDraft(asesorA, agencyA, await oppIn("Calificado"));
    await expectCode(as(t.db, lecturaA, (tx) => sendQuoteVersion(tx, lecturaA.id, agencyA, q.versionId)), "permission_denied");
    await expectCode(as(t.db, lecturaA, (tx) => getSendPlan(tx, lecturaA.id, agencyA, q.versionId)), "permission_denied");
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId));
    await expectCode(as(t.db, lecturaA, (tx) => decideQuoteVersion(tx, lecturaA.id, agencyA, q.versionId, "aceptada")), "permission_denied");
    // B pide la versión de A con su propia agencia: no existe para B.
    await expectCode(as(t.db, adminB, (tx) => decideQuoteVersion(tx, adminB.id, agencyB, q.versionId, "aceptada")), "not_found");
    const q2 = await newDraft(asesorA, agencyA, await oppIn("Calificado"));
    await expectCode(as(t.db, adminB, (tx) => sendQuoteVersion(tx, adminB.id, agencyB, q2.versionId)), "not_found");
    await expectCode(as(t.db, adminB, (tx) => getSendPlan(tx, adminB.id, agencyB, q2.versionId)), "not_found");
    // Aunque B mande el id de la agencia A, no es miembro: no la encuentra.
    await expectCode(as(t.db, adminB, (tx) => sendQuoteVersion(tx, adminB.id, agencyA, q2.versionId)), "not_found");
    expect((await t.admin`select status::text from quote_versions where id = ${q2.versionId}`)[0].status).toBe("borrador");
  });

  it("AC-416: Mi día muestra las enviadas que vencen en 2 días o menos, y una vencida sale de la lista", async () => {
    const opp = await oppIn("Calificado");
    const today = colombiaToday(now());
    const ids: Record<string, string> = {};
    for (const days of [0, 1, 2, 3]) {
      const q = await newDraft(asesorA, agencyA, opp, { ...cartagena, validUntil: addDays(today, days) });
      await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId));
      ids[days] = q.versionId;
    }
    const list = await as(t.db, asesorA, (tx) => expiringQuotes(tx, asesorA.id, agencyA, now()));
    const mine = list.filter((x) => Object.values(ids).includes(x.versionId));
    expect(mine.map((x) => [x.versionId, x.daysToExpire])).toEqual([
      [ids[0], 0],
      [ids[1], 1],
      [ids[2], 2],
    ]);
    // Al día siguiente de vencer: ya no está (se muestra Vencida en la cotización).
    const later = await as(t.db, asesorA, (tx) => expiringQuotes(tx, asesorA.id, agencyA, new Date(now().getTime() + 86_400_000)));
    expect(later.map((x) => x.versionId)).not.toContain(ids[0]);
    expect((await as(t.db, asesorA, (tx) => getQuoteVersion(tx, asesorA.id, agencyA, ids[0], new Date(now().getTime() + 86_400_000)))).status).toBe("vencida");
    // Aceptada ya no avisa; y otra persona de la agencia que no es dueña ni la envió no la ve.
    await as(t.db, asesorA, (tx) => decideQuoteVersion(tx, asesorA.id, agencyA, ids[1], "aceptada"));
    expect((await as(t.db, asesorA, (tx) => expiringQuotes(tx, asesorA.id, agencyA, now()))).map((x) => x.versionId)).not.toContain(ids[1]);
    expect((await as(t.db, lecturaA, (tx) => expiringQuotes(tx, lecturaA.id, agencyA, now()))).map((x) => x.versionId)).not.toContain(ids[2]);
    expect(await as(t.db, adminB, (tx) => expiringQuotes(tx, adminB.id, agencyB, now()))).toEqual([]);
  });
});

describe("parte 3: hallazgos de la prueba independiente (6 nov 2026)", () => {
  it("Mi día también avisa a quien envió la cotización aunque no sea responsable de la oportunidad", async () => {
    const c = await as(t.db, adminA, (tx) => createContact(tx, adminA.id, agencyA, { fullName: "Pedro Dueño", phones: [], emails: [] }));
    const opp = await as(t.db, adminA, (tx) => createOpportunity(tx, adminA.id, agencyA, { contactId: c, destination: "Leticia", ownerId: adminA.id }));
    const q = await newDraft(asesorA, agencyA, opp, { ...cartagena, validUntil: addDays(colombiaToday(now()), 1) });
    await as(t.db, asesorA, (tx) => sendQuoteVersion(tx, asesorA.id, agencyA, q.versionId));
    expect((await as(t.db, asesorA, (tx) => expiringQuotes(tx, asesorA.id, agencyA, now()))).map((x) => x.versionId)).toContain(q.versionId);
    expect((await as(t.db, adminA, (tx) => expiringQuotes(tx, adminA.id, agencyA, now()))).map((x) => x.versionId)).toContain(q.versionId);
  });
});
