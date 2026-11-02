import { firstParams } from "@/domain/params";
import { redirect } from "next/navigation";
import { ActionForm, Input } from "@/components/form";
import { Card, Field, Notice, PageHeader, buttonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { agencyInitials, normalizeHex } from "@/domain/branding";
import { can } from "@/domain/permissions";
import { getBranding } from "@/server/branding";
import { requireActiveAgency } from "@/server/session";
import { renameAgencyAction } from "../../actions";
import { Flash, type SearchParams } from "../../crm-ui";
import { BrandForm } from "./brand-form";

/** Marca de la agencia (RF-240 a RF-242): nombre, colores y logo. Solo administradores. */
export default async function MarcaPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "agency.update")) redirect("/app?error=permission_denied");
  const sp = firstParams(await searchParams);
  const brand = await withUser(getDb(), user, (tx) => getBranding(tx, user.id, active.agencyId));
  const suggestion = normalizeHex(sp.contraste);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="palette" title="Marca de la agencia">
        <p className="text-sm text-slate-600">El nombre, los colores y el logo que verán todas las personas de {active.agencyName}. Cada persona elige aparte el tema y la ubicación del menú en su menú de usuario.</p>
      </PageHeader>
      <Flash sp={sp} />
      {sp.ok === "marca" && (
        <Notice tone="ok">
          Marca guardada. Ya se ve en el menú y en los botones de todas las pantallas.
          {suggestion && ` Como el color principal es claro, los enlaces usan ${suggestion} para que se lean bien.`}
        </Notice>
      )}
      {sp.ok === "agencia" && <Notice tone="ok">Nombre de la agencia actualizado. Ya se ve en el menú.</Notice>}

      <Card title="Colores y logo" icon="palette">
        <BrandForm
          primary={brand.primary}
          accent={brand.accent}
          logoUrl={brand.hasLogo ? `/app/marca/logo?v=${brand.version}` : null}
          initials={agencyInitials(active.agencyName)}
          agencyName={active.agencyName}
        />
      </Card>

      <Card title="Nombre de la agencia" icon="building">
        <ActionForm action={renameAgencyAction} className="flex flex-wrap items-end gap-3">
          <Field label="Nombre">
            <Input id="name" name="name" defaultValue={active.agencyName} required minLength={2} maxLength={120} />
          </Field>
          <button className={buttonClass}>Guardar nombre</button>
        </ActionForm>
      </Card>
    </div>
  );
}
