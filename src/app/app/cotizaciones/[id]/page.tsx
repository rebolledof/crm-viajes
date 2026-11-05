import Link from "next/link";
import { ActionForm, Checkbox, Input, Textarea } from "@/components/form";
import { Icon } from "@/components/icons";
import { Card, Chip, Field, Notice, PageHeader, buttonClass, linkButtonClass, secondaryButtonClass, type ChipTone } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import type { Currency } from "@/domain/money";
import { firstParams } from "@/domain/params";
import { can } from "@/domain/permissions";
import {
  QUOTE_STATUS_LABELS,
  QUOTE_STEPS,
  unitLabel,
  colombiaToday,
  formatAmount,
  formatDecimal,
  formatPercent,
  formatQuoteNumber,
  parseStep,
  sendProblems,
  type QuoteDisplayStatus,
} from "@/domain/quotes";
import { errorMessage } from "@/server/errors";
import { getQuoteScreen, listCatalog } from "@/server/quotes";
import { requireActiveAgency } from "@/server/session";
import { Flash, fecha, fechaHora, formatDay, loadOr404, type SearchParams } from "../../crm-ui";
import { createNextVersionAction, saveQuoteStepAction } from "../../quote-actions";
import { ItemsStep, type CatalogOption } from "./items-step";

const STATUS_TONES: Record<QuoteDisplayStatus, ChipTone> = {
  borrador: "gray",
  enviada: "brand",
  sustituida: "violet",
  aceptada: "green",
  rechazada: "red",
  vencida: "amber",
};

type Screen = Awaited<ReturnType<typeof getQuoteScreen>>;

/** Cotización (SPEC-004 parte 2): borrador en 3 pasos, o la versión tal como quedó. */
export default async function CotizacionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const { id } = await params;
  const sp = firstParams(await searchParams);
  const now = new Date();
  const q = await loadOr404(id, () => withUser(getDb(), user, (tx) => getQuoteScreen(tx, user.id, active.agencyId, id, now)));
  const v = q.version;
  const editable = v.status === "borrador" && can(active.role, "quotes.write") && q.canSeeCosts;
  const step = editable ? parseStep(sp.paso) : 3;
  const catalog: CatalogOption[] =
    editable && step === 1
      ? (await withUser(getDb(), user, (tx) => listCatalog(tx, user.id, active.agencyId))).map((c) => ({
          id: c.id,
          description: c.description,
          supplier: c.supplier,
          unit: c.unit,
          unitCost: c.unitCost,
          costCurrency: c.costCurrency,
          unitPrice: c.unitPrice,
          priceCurrency: c.priceCurrency,
        }))
      : [];
  const draft = q.versions.find((x) => x.status === "borrador");
  const nextNumber = (q.versions[0]?.version ?? v.version) + 1;
  const canWrite = can(active.role, "quotes.write");

  return (
    <div className="flex flex-col gap-4 pb-4">
      <PageHeader
        icon="file"
        eyebrow={
          <>
            Cotización N.º {formatQuoteNumber(q.number)} · Oportunidad{" "}
            <Link href={`/app/oportunidades/${q.opportunity.id}`} className={linkButtonClass}>{q.opportunity.destination || "sin destino"}</Link>
            {" · "}
            <Link href={`/app/contactos/${q.opportunity.contactId}`} className={linkButtonClass}>{q.opportunity.contactName}</Link>
          </>
        }
        title={v.title}
        actions={
          <>
            {editable && step !== 3 && (
              <span className="hidden sm:block">
                <button type="submit" form="cotizacion-paso" name="goTo" value="3" className={secondaryButtonClass}>
                  <Icon name="eye" className="size-4" /> Ver como el cliente
                </button>
              </span>
            )}
            {!editable && canWrite && v.status !== "borrador" && (
              draft ? (
                <Link href={`/app/cotizaciones/${draft.id}`} className={buttonClass}>Abrir el borrador (versión {draft.version})</Link>
              ) : (
                <form action={createNextVersionAction}>
                  <input type="hidden" name="versionId" value={v.id} />
                  <button type="submit" className={buttonClass}><Icon name="plus" className="size-4" /> Crear versión {nextNumber}</button>
                </form>
              )
            )}
          </>
        }
      >
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Chip tone={STATUS_TONES[q.status]}>{QUOTE_STATUS_LABELS[q.status]} · versión {v.version}</Chip>
          <span>Guardada {fechaHora.format(v.updatedAt)}</span>
        </p>
      </PageHeader>
      <Flash sp={sp} />

      {editable && <Stepper step={step} />}
      {!editable && q.versions.length > 1 && <VersionList q={q} />}

      {editable && step === 1 && (
        <ItemsStep
          versionId={v.id}
          saleCurrency={v.saleCurrency as Currency}
          exchangeRate={q.exchangeRate}
          minMarginPct={q.minMarginPct}
          catalog={catalog}
          items={q.items.map((i) => ({
            description: i.description,
            supplier: i.supplier ?? "",
            quantity: formatDecimal(i.quantity),
            unit: i.unit,
            unitPrice: formatDecimal(i.unitPrice),
            unitCost: formatDecimal(i.unitCost),
            costCurrency: i.costCurrency,
            catalogServiceId: i.catalogServiceId ?? "",
          }))}
        />
      )}
      {editable && step === 2 && <ConditionsStep q={q} />}
      {step === 3 && <Review q={q} editable={editable} now={now} />}
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Pasos de la cotización" className="rounded border border-line bg-surface px-4 py-3 shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
      <p className="text-sm font-semibold text-slate-900 sm:hidden">
        Paso {step} de 3: <span className="font-normal">{QUOTE_STEPS[step - 1]}</span>
      </p>
      <ol className="hidden items-center gap-3 sm:flex">
        {QUOTE_STEPS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const current = n === step;
          const circle = `flex size-7 items-center justify-center rounded-full border-2 text-sm ${current ? "border-accent font-bold text-accent-text" : n < step ? "border-brand bg-brand text-brand-contrast" : "border-slate-300 text-slate-600"}`;
          // Cambiar de paso guarda lo escrito (los botones envían el formulario del paso actual).
          const inner = (
            <>
              <span className={circle}>{n < step ? <Icon name="done" className="size-4" /> : n}</span>
              <span className={current ? "font-semibold text-slate-900" : "text-slate-700"}>{label}</span>
            </>
          );
          return (
            <li key={label} className="flex items-center gap-3">
              {i > 0 && <span className="h-px w-8 bg-slate-300" aria-hidden />}
              {current ? (
                <span aria-current="step" className="flex items-center gap-2 text-sm">{inner}</span>
              ) : step === 3 ? (
                <Link href={`?paso=${n}`} className="flex items-center gap-2 rounded text-sm hover:underline">{inner}</Link>
              ) : (
                <button type="submit" form="cotizacion-paso" name="goTo" value={n} className="flex items-center gap-2 rounded text-sm hover:underline">{inner}</button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function VersionList({ q }: { q: Screen }) {
  return (
    <Card title="Versiones" icon="list" bodyClassName="px-4 py-2">
      <ul className="divide-y divide-slate-100 text-sm">
        {q.versions.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
            {x.id === q.version.id ? <strong>Versión {x.version}</strong> : <Link href={`/app/cotizaciones/${x.id}`} className={linkButtonClass}>Versión {x.version}</Link>}
            <Chip tone={STATUS_TONES[x.displayStatus]}>{QUOTE_STATUS_LABELS[x.displayStatus]}</Chip>
            {x.saleTotal && <span className="text-slate-700">{formatAmount(x.saleTotal, x.saleCurrency as Currency)}</span>}
            {x.sentAt && <span className="text-slate-600">enviada {fechaHora.format(x.sentAt)}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ConditionsStep({ q }: { q: Screen }) {
  const v = q.version;
  const today = colombiaToday(new Date());
  return (
    <ActionForm id="cotizacion-paso" action={saveQuoteStepAction} className="flex flex-col gap-4">
      <input type="hidden" name="versionId" value={v.id} />
      <input type="hidden" name="step" value="2" />
      <Card title="Cliente y viaje" icon="plane">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Título de la cotización">
            <Input name="quoteTitle" defaultValue={v.title} required maxLength={160} placeholder="Cartagena, 4 noches para 2 adultos" />
          </Field>
          <Field label="Cliente (como sale en la cotización)">
            <Input name="clientName" defaultValue={v.clientName} required maxLength={160} />
          </Field>
          <Field label="Destino">
            <Input name="destination" defaultValue={v.destination} maxLength={160} />
          </Field>
          <Field label="Viajeros">
            <Input name="travelers" type="number" min={1} max={999} defaultValue={v.travelers} />
          </Field>
          <Field label="Salida">
            <Input name="travelStart" type="date" defaultValue={v.travelStart} />
          </Field>
          <Field label="Regreso">
            <Input name="travelEnd" type="date" defaultValue={v.travelEnd} />
          </Field>
        </div>
      </Card>
      <Card title="Condiciones" icon="note">
        <div className="flex flex-col gap-3">
          <Field label="Válida hasta">
            <Input name="validUntil" type="date" min={today} defaultValue={v.validUntil} required className="max-w-48" />
          </Field>
          <Field label="Incluye">
            <Textarea name="includes" defaultValue={v.includes} rows={3} maxLength={4000} placeholder="Alojamiento con desayuno, traslados, seguro de viaje…" />
          </Field>
          <Field label="No incluye">
            <Textarea name="excludes" defaultValue={v.excludes} rows={3} maxLength={4000} placeholder="Gastos personales, propinas…" />
          </Field>
          <Field label="Forma de pago">
            <Textarea name="paymentTerms" defaultValue={v.paymentTerms} rows={2} maxLength={4000} placeholder="50 % para reservar y el saldo 15 días antes del viaje." />
          </Field>
          <Field label="Política de cancelación">
            <Textarea name="cancellationPolicy" defaultValue={v.cancellationPolicy} rows={2} maxLength={4000} />
          </Field>
          <Checkbox name="showItemPrices" defaultChecked={v.showItemPrices} label="Mostrar al cliente el precio de cada servicio (si lo desmarcas, solo ve el total)" />
          <p className="text-xs text-slate-600">Los textos por defecto los define el administrador en Configuración › Cotizaciones. Lo que cambies aquí vale solo para esta cotización.</p>
        </div>
      </Card>
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button type="submit" name="goTo" value="1" className={secondaryButtonClass}><Icon name="left" className="size-4" /> Servicios</button>
        <button type="submit" name="goTo" value="2" className={secondaryButtonClass}>Guardar</button>
        <button type="submit" name="goTo" value="3" className={buttonClass}>Siguiente: revisar <Icon name="right" className="size-4" /></button>
      </div>
    </ActionForm>
  );
}

const STEP_OF_FIELD: Record<string, 1 | 2> = { items: 1, exchangeRate: 1, validUntil: 2 };

function Review({ q, editable, now }: { q: Screen; editable: boolean; now: Date }) {
  const v = q.version;
  const currency = v.saleCurrency as Currency;
  const total = v.saleTotal ?? q.saleTotal;
  const problems = editable
    ? sendProblems({ saleCurrency: currency, exchangeRate: q.canSeeCosts ? q.exchangeRate : null, validUntil: v.validUntil, items: q.canSeeCosts ? q.items.map((i) => ({ costCurrency: i.costCurrency as Currency })) : [] }, colombiaToday(now))
    : [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section id="cliente" aria-labelledby="vista-cliente" className="rounded border border-line bg-surface shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <Icon name="eye" className="size-4 text-slate-500" />
          <h2 id="vista-cliente" className="font-semibold text-slate-900">Así la verá el cliente</h2>
          <span className="ml-auto text-xs text-slate-600">Sin costes, utilidad, margen ni tipo de cambio</span>
        </header>
        <div className="flex flex-col gap-4 p-4 text-sm text-slate-800">
          <div>
            <p className="text-lg font-bold text-slate-900">{v.title}</p>
            <p>Para {v.clientName}{v.destination ? ` · ${v.destination}` : ""}</p>
            <p className="text-slate-600">
              {v.travelStart ? `Del ${formatDay(v.travelStart)}${v.travelEnd ? ` al ${formatDay(v.travelEnd)}` : ""}` : "Fechas por definir"}
              {v.travelers ? ` · ${v.travelers} ${v.travelers === 1 ? "viajero" : "viajeros"}` : ""}
              {v.validUntil ? ` · Válida hasta el ${fecha.format(new Date(`${v.validUntil}T00:00:00Z`))}` : ""}
            </p>
          </div>
          {q.items.length === 0 ? (
            <Notice>Todavía no hay servicios. {editable && <Link href="?paso=1" className="font-medium underline">Agrégalos en el paso 1</Link>}</Notice>
          ) : (
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-600">
                <tr>
                  <th className="py-2 font-medium">Servicio</th>
                  <th className="py-2 text-right font-medium">Cantidad</th>
                  {v.showItemPrices && <th className="py-2 text-right font-medium">Valor</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-2">{i.description}</td>
                    <td className="py-2 text-right whitespace-nowrap">{unitLabel(i.unit, i.quantity, formatDecimal)}</td>
                    {v.showItemPrices && <td className="py-2 text-right whitespace-nowrap">{formatAmount(i.lineTotal, currency)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold text-slate-900">
                  <td className="py-2" colSpan={v.showItemPrices ? 2 : 1}>Total</td>
                  <td className="py-2 text-right whitespace-nowrap">{formatAmount(total, currency)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {(
            [
              ["Incluye", v.includes],
              ["No incluye", v.excludes],
              ["Forma de pago", v.paymentTerms],
              ["Política de cancelación", v.cancellationPolicy],
            ] as const
          ).map(([label, text]) =>
            text ? (
              <div key={label}>
                <h3 className="font-semibold text-slate-900">{label}</h3>
                <p className="whitespace-pre-line">{text}</p>
              </div>
            ) : null,
          )}
          <p className="text-xs text-slate-600">El PDF con el logo y los colores de la agencia se genera al enviar (próxima entrega).</p>
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        {q.canSeeCosts && (
          <section className="rounded border border-line bg-surface shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
            <h2 className="flex items-center gap-2 border-b-2 border-amber-200 px-4 py-2.5 font-semibold text-slate-900">
              <Icon name="lock" className="size-4" /> Solo para la agencia
            </h2>
            <dl className="divide-y divide-slate-100 px-4 text-sm">
              <div className="flex justify-between py-2"><dt>Coste total</dt><dd>{q.missingRate ? "falta el tipo de cambio" : formatAmount(q.totals.cost, currency)}</dd></div>
              <div className="flex justify-between py-2"><dt>Venta total</dt><dd>{formatAmount(q.totals.sale, currency)}</dd></div>
              <div className="flex justify-between py-2 font-semibold"><dt>Utilidad</dt><dd>{q.missingRate ? "—" : formatAmount(q.totals.profit, currency)}</dd></div>
              <div className="flex justify-between py-2"><dt>Margen sobre venta</dt><dd>{q.missingRate ? "—" : formatPercent(q.totals.margin)}</dd></div>
              <div className="flex justify-between py-2"><dt>Recargo sobre coste</dt><dd>{q.missingRate ? "—" : formatPercent(q.totals.markup)}</dd></div>
              {q.exchangeRate && <div className="flex justify-between py-2"><dt>Tipo de cambio</dt><dd>1 USD = {formatDecimal(q.exchangeRate)} COP</dd></div>}
            </dl>
            {(q.lowMarginTotal || q.items.some((i) => i.lowMargin)) && (
              <p className="m-3 flex gap-2 rounded bg-amber-50 p-3 text-sm text-amber-900" role="status">
                <Icon name="alert" className="mt-0.5 size-4" />
                <span>Hay servicios o un total por debajo del margen mínimo de la agencia ({formatDecimal(q.minMarginPct)} %). Es un aviso: se puede enviar igual.</span>
              </p>
            )}
          </section>
        )}
        {editable && (
          <section className="rounded border border-line bg-surface p-4 shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
            <h2 className="font-semibold text-slate-900">Antes de enviar</h2>
            {problems.length ? (
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {problems.map((p) => (
                  <li key={p.code} className="flex gap-2 text-red-900">
                    <Icon name="alert" className="mt-0.5 size-4" />
                    <span>
                      {errorMessage(p.code, p.field)}{" "}
                      <Link href={`?paso=${STEP_OF_FIELD[p.field] ?? 1}`} className="font-medium underline">Corregir</Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 flex gap-2 text-sm text-emerald-900"><Icon name="done" className="mt-0.5 size-4" /> Está lista: tiene servicios, vigencia y tipo de cambio si hace falta.</p>
            )}
            <p className="mt-3 text-sm text-slate-700">
              El botón <strong>Enviar</strong> llega en la próxima entrega: congelará esta versión, generará el PDF y pasará la oportunidad a «Propuesta enviada». Por ahora la cotización queda guardada en borrador.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="?paso=2" className={secondaryButtonClass}><Icon name="left" className="size-4" /> Condiciones</Link>
              <Link href={`/app/oportunidades/${q.opportunity.id}`} className={secondaryButtonClass}>Volver a la oportunidad</Link>
            </div>
          </section>
        )}
        {!editable && v.status === "borrador" && <Notice>Esta versión está en borrador. {q.canSeeCosts ? "Solo administradores y asesores pueden cambiarla." : "Solo administradores y asesores pueden cambiarla y ver sus costes."}</Notice>}
      </aside>
    </div>
  );
}
