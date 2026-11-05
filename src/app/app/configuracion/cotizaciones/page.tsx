import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Input, Textarea } from "@/components/form";
import { Card, Field, PageHeader, buttonClass, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { firstParams } from "@/domain/params";
import { can } from "@/domain/permissions";
import { formatDecimal } from "@/domain/quotes";
import { getQuoteSettings } from "@/server/quotes";
import { requireActiveAgency } from "@/server/session";
import { Flash, type SearchParams } from "../../crm-ui";
import { updateQuoteSettingsAction } from "../../quote-actions";

/** Configuración › Cotizaciones (SPEC-004 alcance 17). Solo el administrador. */
export default async function AjustesCotizacionesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "quotes.manage")) redirect("/app?error=permission_denied");
  const sp = firstParams(await searchParams);
  const s = await withUser(getDb(), user, (tx) => getQuoteSettings(tx, user.id, active.agencyId));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="file" title="Ajustes de cotizaciones" actions={<Link href="/app/configuracion/catalogo" className={linkButtonClass}>Catálogo de servicios</Link>}>
        <p className="text-sm text-slate-600">Lo que se precarga en cada cotización nueva de {active.agencyName}. Cambiarlo no toca las cotizaciones que ya existen.</p>
      </PageHeader>
      <Flash sp={sp} />
      <ActionForm action={updateQuoteSettingsAction} className="flex flex-col gap-4">
        <Card title="Margen y vigencia" icon="trend">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Margen mínimo de aviso (%)">
              <Input name="minMarginPct" defaultValue={formatDecimal(s.minMarginPct)} required inputMode="decimal" className="max-w-32 text-right" />
              <span className="text-xs text-slate-600">Si un servicio o el total gana menos que esto sobre la venta, el asesor ve un aviso ámbar. No bloquea el envío. De 0 a 90.</span>
            </Field>
            <Field label="Vigencia por defecto (días)">
              <Input name="validityDays" type="number" min={1} max={90} defaultValue={s.validityDays} required className="max-w-32" />
              <span className="text-xs text-slate-600">La cotización nueva vale hasta hoy más estos días. El asesor puede cambiar la fecha.</span>
            </Field>
          </div>
        </Card>
        <Card title="Textos por defecto de las condiciones" icon="note">
          <div className="flex flex-col gap-3">
            <Field label="Incluye">
              <Textarea name="defaultIncludes" defaultValue={s.defaultIncludes} rows={3} maxLength={4000} />
            </Field>
            <Field label="No incluye">
              <Textarea name="defaultExcludes" defaultValue={s.defaultExcludes} rows={3} maxLength={4000} />
            </Field>
            <Field label="Forma de pago">
              <Textarea name="defaultPaymentTerms" defaultValue={s.defaultPaymentTerms} rows={2} maxLength={4000} />
            </Field>
            <Field label="Política de cancelación">
              <Textarea name="defaultCancellation" defaultValue={s.defaultCancellation} rows={2} maxLength={4000} />
            </Field>
          </div>
        </Card>
        <div className="flex justify-end">
          <button type="submit" className={buttonClass}>Guardar ajustes</button>
        </div>
      </ActionForm>
    </div>
  );
}
