import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Checkbox, Input, Select } from "@/components/form";
import { Card, Chip, Field, PageHeader, buttonClass, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { CURRENCIES } from "@/domain/money";
import { firstParams } from "@/domain/params";
import { can } from "@/domain/permissions";
import { QUOTE_UNITS, QUOTE_UNIT_LABELS, formatDecimal } from "@/domain/quotes";
import { listCatalog } from "@/server/quotes";
import { requireActiveAgency } from "@/server/session";
import { Flash, type SearchParams } from "../../crm-ui";
import { saveCatalogAction } from "../../quote-actions";

type Service = Awaited<ReturnType<typeof listCatalog>>[number];

/** Configuración › Catálogo (SPEC-004 alcance 16). Solo el administrador lo cambia. */
export default async function CatalogoPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "quotes.manage")) redirect("/app?error=permission_denied");
  const sp = firstParams(await searchParams);
  const services = await withUser(getDb(), user, (tx) => listCatalog(tx, user.id, active.agencyId, { includeInactive: true }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="book" eyebrow={<Link href="/app/configuracion/cotizaciones" className={linkButtonClass}>Cotizaciones</Link>} title="Catálogo de servicios">
        <p className="text-sm text-slate-600">Servicios que el equipo usa seguido, con su coste y su venta de referencia. Al agregarlos a una cotización se copian: cambiar el catálogo no cambia las cotizaciones que ya los usan.</p>
      </PageHeader>
      <Flash sp={sp} />

      <Card title="Nuevo servicio" icon="plus">
        <ServiceForm />
      </Card>

      <Card title={`Servicios (${services.length})`} icon="list" bodyClassName="px-4">
        {services.length === 0 ? (
          <p className="py-4 text-sm text-slate-700">El catálogo está vacío. Agrega arriba los servicios que más cotizan (hoteles, traslados, seguros) para no escribirlos cada vez.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {services.map((s) => (
              <li key={s.id} id={`servicio-${s.id}`} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-900">{s.description}</span>
                    {s.supplier && <span className="text-slate-600">· {s.supplier}</span>}
                    <span className="text-slate-700">
                      · venta {formatDecimal(s.unitPrice)} {s.priceCurrency} por {QUOTE_UNIT_LABELS[s.unit]} · coste {formatDecimal(s.unitCost)} {s.costCurrency}
                    </span>
                    {!s.active && <Chip>Desactivado</Chip>}
                    <span className="ml-auto text-brand-text">Editar</span>
                  </summary>
                  <div className="mt-3">
                    <ServiceForm service={s} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ServiceForm({ service }: { service?: Service }) {
  return (
    <ActionForm action={saveCatalogAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {service && <input type="hidden" name="catalogId" value={service.id} />}
      <div className="sm:col-span-2">
        <Field label="Descripción">
          <Input name="description" defaultValue={service?.description} required maxLength={300} placeholder="Traslado aeropuerto–hotel–aeropuerto" />
        </Field>
      </div>
      <Field label="Proveedor">
        <Input name="supplier" defaultValue={service?.supplier} maxLength={160} placeholder="Operador local" />
      </Field>
      <Field label="Unidad">
        <Select name="unit" defaultValue={service?.unit ?? "servicio"}>
          {QUOTE_UNITS.map((u) => (
            <option key={u} value={u}>{QUOTE_UNIT_LABELS[u]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Coste de referencia (solo agencia)">
        <Input name="unitCost" defaultValue={service ? formatDecimal(service.unitCost) : ""} inputMode="decimal" placeholder="120.000" className="text-right" />
      </Field>
      <Field label="Moneda del coste">
        <Select name="costCurrency" defaultValue={service?.costCurrency ?? "COP"}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Venta de referencia">
        <Input name="unitPrice" defaultValue={service ? formatDecimal(service.unitPrice) : ""} required inputMode="decimal" placeholder="180.000" className="text-right" />
      </Field>
      <Field label="Moneda de la venta">
        <Select name="priceCurrency" defaultValue={service?.priceCurrency ?? "COP"}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-4">
        {service && <Checkbox name="active" defaultChecked={service.active} label="Activo (si lo desactivas, ya no aparece al armar cotizaciones)" />}
        <button type="submit" className={`${buttonClass} ml-auto`}>{service ? "Guardar cambios" : "Agregar al catálogo"}</button>
      </div>
    </ActionForm>
  );
}
