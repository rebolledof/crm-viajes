"use client";

// Paso 1 · Servicios y precios (SPEC-004 alcance 3 a 6). Los totales se calculan en el navegador
// con las mismas reglas del dominio mientras se escribe; al guardar, la base vuelve a calcularlos
// y lo guardado es lo que vale.
import { useMemo, useState } from "react";
import { ActionForm, Input, Select, useFormState } from "@/components/form";
import { Icon } from "@/components/icons";
import { Field, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { CURRENCIES, type Currency } from "@/domain/money";
import {
  QUOTE_UNITS,
  QUOTE_UNIT_LABELS,
  belowMinMargin,
  formatAmount,
  formatDecimal,
  formatPercent,
  indicators,
  lineTotals,
  needsExchangeRate,
  parseExchangeRate,
  parseQuantity,
  parseUnitAmount,
  sumAmounts,
  type QuoteUnit,
} from "@/domain/quotes";
import { saveQuoteStepAction } from "../../quote-actions";

export type EditorItem = {
  description: string;
  supplier: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  unitCost: string;
  costCurrency: string;
  catalogServiceId: string;
};

export type CatalogOption = {
  id: string;
  description: string;
  supplier: string | null;
  unit: QuoteUnit;
  unitCost: string;
  costCurrency: Currency;
  unitPrice: string;
  priceCurrency: Currency;
};

type Props = {
  versionId: string;
  saleCurrency: Currency;
  exchangeRate: string | null;
  items: EditorItem[];
  minMarginPct: string;
  catalog: CatalogOption[];
};

export function ItemsStep(props: Props) {
  return (
    <ActionForm id="cotizacion-paso" action={saveQuoteStepAction} className="flex flex-col gap-4">
      <ItemsFields {...props} />
    </ActionForm>
  );
}

type Row = EditorItem & { key: number };

let nextKey = 1;
const blank = (currency: string): Row => ({ key: nextKey++, description: "", supplier: "", quantity: "1", unit: "servicio", unitPrice: "", unitCost: "", costCurrency: currency, catalogServiceId: "" });

/** Lo que el servidor devolvió en un rechazo, o lo guardado. */
function initialRows(values: Record<string, string[]> | undefined, saved: EditorItem[]): Row[] {
  if (!values) return saved.map((i) => ({ ...i, key: nextKey++ }));
  const d = values.description ?? [];
  const g = (k: string, i: number) => values[k]?.[i] ?? "";
  return d.map((description, i) => ({
    key: nextKey++,
    description,
    supplier: g("supplier", i),
    quantity: g("quantity", i),
    unit: g("unit", i),
    unitPrice: g("unitPrice", i),
    unitCost: g("unitCost", i),
    costCurrency: g("costCurrency", i),
    catalogServiceId: g("catalogServiceId", i),
  }));
}

function money(value: string | null, currency: Currency): string {
  return value === null ? "—" : formatAmount(value, currency);
}

function ItemsFields({ versionId, saleCurrency: savedCurrency, exchangeRate: savedRate, items, minMarginPct, catalog }: Props) {
  const state = useFormState();
  const [currency, setCurrency] = useState<Currency>(() => {
    const sent = state.values?.saleCurrency?.[0];
    return sent === "USD" || sent === "COP" ? sent : savedCurrency;
  });
  const [rate, setRate] = useState(state.values?.exchangeRate?.[0] ?? (savedRate ? formatDecimal(savedRate) : ""));
  const [rows, setRows] = useState<Row[]>(() => initialRows(state.values, items));
  const [pick, setPick] = useState("");
  const [notice, setNotice] = useState("");

  const parsedRate = rate.trim() ? parseExchangeRate(rate) : null;
  const needsRate = needsExchangeRate(rows.map((r) => ({ costCurrency: r.costCurrency as Currency })), currency);

  const calc = useMemo(() => {
    const lines = rows.map((r) => {
      const quantity = parseQuantity(r.quantity);
      const price = parseUnitAmount(r.unitPrice);
      const cost = r.unitCost.trim() ? parseUnitAmount(r.unitCost) : "0";
      const costCurrency = (r.costCurrency === "USD" || r.costCurrency === "COP" ? r.costCurrency : currency) as Currency;
      if (quantity === null || price === null || cost === null) return { ok: false as const, quantity, price, cost, costCurrency };
      const t = lineTotals({ quantity, unitPrice: price, unitCost: cost, costCurrency }, currency, parsedRate);
      const ind = t.cost === null ? null : indicators(t.sale, t.cost);
      return { ok: true as const, quantity, price, cost, costCurrency, sale: t.sale, lineCost: t.cost, ind, low: t.cost !== null && belowMinMargin(t.sale, t.cost, minMarginPct) };
    });
    const valid = lines.filter((l) => l.ok);
    const sale = sumAmounts(valid.map((l) => (l.ok ? l.sale : "0")));
    const missing = valid.some((l) => l.ok && l.lineCost === null);
    const cost = sumAmounts(valid.map((l) => (l.ok ? (l.lineCost ?? "0") : "0")));
    const totals = indicators(sale, cost);
    const lowCount = valid.filter((l) => l.ok && l.low).length;
    return { lines, sale, cost, totals, missing, lowCount, lowTotal: !missing && valid.length > 0 && belowMinMargin(sale, cost, minMarginPct), incomplete: valid.length < lines.length };
  }, [rows, currency, parsedRate, minMarginPct]);

  const update = (key: number, patch: Partial<EditorItem>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, delta: number) =>
    setRows((rs) => {
      const to = index + delta;
      if (to < 0 || to >= rs.length) return rs;
      const copy = rs.slice();
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });
  const remove = (key: number, label: string, index: number) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    // El foco va al servicio que queda en su lugar o a "Agregar servicio" (uso con teclado).
    requestAnimationFrame(() => {
      const items = document.querySelectorAll<HTMLInputElement>('li[aria-label^="Servicio "] input[name="description"]');
      (items[Math.min(index, items.length - 1)] ?? document.getElementById("agregar-servicio"))?.focus();
    });
    setNotice(`Quitaste «${label || "servicio sin descripción"}». Se borra de la cotización cuando guardes; si fue un error, recarga la página sin guardar.`);
  };
  const addBlank = () => {
    setRows((rs) => [...rs, blank(currency)]);
    setNotice("");
  };
  const addFromCatalog = () => {
    const c = catalog.find((x) => x.id === pick);
    if (!c) return;
    // Se copia (RF-412): cambiar el catálogo después no cambia esta cotización.
    setRows((rs) => [
      ...rs,
      {
        key: nextKey++,
        description: c.description,
        supplier: c.supplier ?? "",
        quantity: "1",
        unit: c.unit,
        unitPrice: c.priceCurrency === currency ? formatDecimal(c.unitPrice) : "",
        unitCost: formatDecimal(c.unitCost),
        costCurrency: c.costCurrency,
        catalogServiceId: c.id,
      },
    ]);
    setNotice(c.priceCurrency === currency ? `Agregaste «${c.description}» del catálogo.` : `Agregaste «${c.description}». Su precio de referencia está en ${c.priceCurrency}: escribe la venta en ${currency}.`);
    setPick("");
  };

  return (
    <>
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="step" value="1" />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded border border-line bg-surface shadow-[0_2px_2px_rgba(0,0,0,0.05)]" aria-labelledby="servicios-titulo">
          <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <h2 id="servicios-titulo" className="font-semibold text-slate-900">
              Servicios <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{rows.length}</span>
            </h2>
            <div className="ml-auto flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                Moneda de venta
                <Select name="saleCurrency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className="w-24">
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </label>
            </div>
          </header>

          {(needsRate || rate.trim()) && (
            <div className="flex flex-col gap-1 border-b border-slate-100 bg-amber-50/40 px-4 py-3">
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
                <Icon name="lock" className="size-4 text-slate-500" />
                <span className="font-medium after:ml-0.5 after:text-red-700 after:content-['*']">Tipo de cambio de esta cotización: 1 USD =</span>
                <Input name="exchangeRate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="4.000" className="w-32 text-right" aria-describedby="tc-ayuda" />
                <span>COP</span>
              </label>
              <p id="tc-ayuda" className="text-xs text-slate-600">
                {rate.trim() && !parsedRate
                  ? "No entendemos ese número. Escríbelo como 4.000 o 4.000,50."
                  : parsedRate
                    ? `Se usará 1 USD = ${formatDecimal(parsedRate)} COP para convertir los costes que están en otra moneda. El cliente no lo ve.`
                    : "Algún coste está en otra moneda: escribe cuántos pesos vale 1 dólar. Sin esto no podrás enviar la cotización."}
              </p>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-600">
              <p className="font-medium text-slate-800">Esta cotización todavía no tiene servicios.</p>
              <p className="mt-1">Agrega el hotel, el vuelo, los traslados o lo que incluya el viaje con «Agregar servicio»{catalog.length ? " o elígelos del catálogo" : ""}.</p>
            </div>
          ) : (
            <ol className="divide-y divide-slate-100">
              {rows.map((r, i) => {
                const l = calc.lines[i];
                const costCur = l.costCurrency;
                return (
                  <li key={r.key} className="flex flex-col gap-3 px-4 py-4" aria-label={`Servicio ${i + 1}`}>
                    <input type="hidden" name="catalogServiceId" value={r.catalogServiceId} />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                      <Field label={`${i + 1}. Descripción`}>
                        <Input name="description" index={i} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} required maxLength={300} placeholder="Ej.: hotel, vuelo, traslado o seguro" />
                      </Field>
                      <Field label="Proveedor">
                        <Input name="supplier" index={i} value={r.supplier} onChange={(e) => update(r.key, { supplier: e.target.value })} maxLength={160} placeholder="Hotel, aerolínea u operador" />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[5.5rem_8rem_minmax(0,1fr)_minmax(0,1fr)]">
                      <Field label="Cantidad">
                        <Input name="quantity" index={i} value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} required inputMode="decimal" className="text-right" />
                      </Field>
                      <Field label="Unidad">
                        <select name="unit" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} className={inputClass}>
                          {QUOTE_UNITS.map((u) => (
                            <option key={u} value={u}>{QUOTE_UNIT_LABELS[u]}</option>
                          ))}
                        </select>
                      </Field>
                      <div className="col-span-2 sm:col-span-1"><Field label="Coste por unidad (solo agencia)">
                        <div className="flex gap-1">
                          <Input name="unitCost" index={i} value={r.unitCost} onChange={(e) => update(r.key, { unitCost: e.target.value })} inputMode="decimal" placeholder="0" className="min-w-0 flex-1 text-right" />
                          <select name="costCurrency" aria-label="Moneda del coste" value={r.costCurrency} onChange={(e) => update(r.key, { costCurrency: e.target.value })} className={`${inputClass} w-[5.25rem] px-2`}>
                            {CURRENCIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      </Field></div>
                      <div className="col-span-2 sm:col-span-1"><Field label={`Venta por unidad (${currency})`}>
                        <Input name="unitPrice" index={i} value={r.unitPrice} onChange={(e) => update(r.key, { unitPrice: e.target.value })} required inputMode="decimal" placeholder="0" className="text-right font-semibold" />
                      </Field></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      {l.ok ? (
                        <>
                          <span className="text-slate-800">
                            Venta: {formatDecimal(l.quantity)} × {formatDecimal(l.price)} = <strong>{formatAmount(l.sale, currency)}</strong>
                          </span>
                          <span className="flex items-center gap-1 text-slate-600">
                            <Icon name="lock" className="size-3.5" />
                            Coste {formatDecimal(l.quantity)} × {formatDecimal(l.cost)} {costCur}
                            {costCur !== currency ? (l.lineCost === null ? " · falta el tipo de cambio" : ` = ${formatAmount(l.lineCost, currency)}`) : ` = ${money(l.lineCost, currency)}`}
                          </span>
                          {l.ind && (
                            <span className="flex items-center gap-1 text-slate-600">
                              <Icon name="lock" className="size-3.5" />
                              Utilidad {formatAmount(l.ind.profit, currency)} ·{" "}
                              {l.low ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                                  <Icon name="alert" className="size-3" /> margen {formatPercent(l.ind.margin)}
                                </span>
                              ) : (
                                <>margen {formatPercent(l.ind.margin)}</>
                              )}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-600">Escribe la cantidad y la venta para ver el total de este servicio.</span>
                      )}
                      <span className="ml-auto flex gap-1">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label={`Subir el servicio ${i + 1}`}>
                          <Icon name="up" className="size-4" />
                        </button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label={`Bajar el servicio ${i + 1}`}>
                          <Icon name="down" className="size-4" />
                        </button>
                        <button type="button" onClick={() => remove(r.key, r.description, i)} className="rounded p-1.5 text-red-700 hover:bg-red-50" aria-label={`Quitar el servicio ${i + 1}`}>
                          <Icon name="trash" className="size-4" />
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
            <button type="button" id="agregar-servicio" onClick={addBlank} className={secondaryButtonClass} disabled={rows.length >= 60}>
              <Icon name="plus" className="size-4" /> Agregar servicio
            </button>
            {catalog.length > 0 && (
              <span className="flex flex-wrap items-center gap-2">
                <select aria-label="Servicio del catálogo" value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputClass} max-w-64`}>
                  <option value="">Elegir del catálogo…</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>{c.description}{c.supplier ? ` · ${c.supplier}` : ""}</option>
                  ))}
                </select>
                <button type="button" onClick={addFromCatalog} disabled={!pick || rows.length >= 60} className={secondaryButtonClass}>
                  <Icon name="book" className="size-4" /> Agregar del catálogo
                </button>
              </span>
            )}
            <span className="ml-auto flex items-center gap-1 text-xs text-slate-600">
              <Icon name="lock" className="size-3.5" /> El coste, la utilidad y el margen solo los ve la agencia
            </span>
            {notice && <p role="status" className="w-full text-sm text-slate-700">{notice}</p>}
          </footer>
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <section className="rounded border border-line bg-surface p-4 shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
            <h2 className="font-semibold text-slate-900">Total para el cliente</h2>
            <p className="mt-2 text-2xl font-bold text-brand-text" aria-live="polite">{formatAmount(calc.sale, currency)}</p>
            <p className="text-xs text-slate-600">Es lo que verá el cliente en la cotización.{calc.incomplete ? " Hay servicios sin cantidad o venta que todavía no suman." : ""}</p>
          </section>
          <section className="rounded border border-line bg-surface shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
            <h2 className="flex items-center gap-2 border-b-2 border-amber-200 px-4 py-2.5 font-semibold text-slate-900">
              <Icon name="lock" className="size-4" /> Solo para la agencia
            </h2>
            <dl className="divide-y divide-slate-100 px-4 text-sm">
              <div className="flex justify-between py-2"><dt>Coste total</dt><dd>{calc.missing ? "falta el tipo de cambio" : formatAmount(calc.cost, currency)}</dd></div>
              <div className="flex justify-between py-2"><dt>Venta total</dt><dd>{formatAmount(calc.sale, currency)}</dd></div>
              <div className="flex justify-between py-2 font-semibold"><dt>Utilidad</dt><dd>{calc.missing ? "—" : formatAmount(calc.totals.profit, currency)}</dd></div>
              <div className="flex justify-between py-2"><dt>Margen sobre venta</dt><dd>{calc.missing ? "—" : formatPercent(calc.totals.margin)}</dd></div>
              <div className="flex justify-between py-2"><dt>Recargo sobre coste</dt><dd>{calc.missing ? "—" : formatPercent(calc.totals.markup)}</dd></div>
            </dl>
            {(calc.lowCount > 0 || calc.lowTotal) && (
              <p className="m-3 flex gap-2 rounded bg-amber-50 p-3 text-sm text-amber-900" role="status">
                <Icon name="alert" className="mt-0.5 size-4" />
                <span>
                  {calc.lowCount > 0 ? `${calc.lowCount === 1 ? "1 servicio está" : `${calc.lowCount} servicios están`} por debajo` : "El total está por debajo"} del margen mínimo de la agencia ({formatDecimal(minMarginPct)} %). Es un aviso: puedes enviar igual.
                </span>
              </p>
            )}
          </section>
          <p className="flex gap-2 rounded bg-brand-softer p-3 text-sm text-slate-800">
            <Icon name="zap" className="mt-0.5 size-4 text-brand-text" />
            <span><strong>Siguiente paso:</strong> revisa los precios y pasa a <strong>Condiciones</strong> (vigencia, qué incluye y forma de pago).</span>
          </p>
          <div className="hidden flex-col gap-2 lg:flex">
            <button type="submit" name="goTo" value="2" className={buttonClass}>Guardar y seguir: condiciones <Icon name="right" className="size-4" /></button>
            <button type="submit" name="goTo" value="1" className={secondaryButtonClass}>Guardar y quedarme aquí</button>
          </div>
        </aside>
      </div>

      {/* En el celular el total y la acción principal quedan siempre a la vista (imagen 6). */}
      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t border-line bg-surface px-4 py-3 lg:hidden">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-600">Total para el cliente</div>
          <div className="text-base font-bold break-words text-slate-900">{formatAmount(calc.sale, currency)}</div>
        </div>
        <button type="submit" name="goTo" value="1" className={`${secondaryButtonClass} px-3`}>Guardar</button>
        <button type="submit" name="goTo" value="2" className={`${buttonClass} px-3`}>Siguiente <Icon name="right" className="size-4" /></button>
      </div>
    </>
  );
}

