import { PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { getSettings } from "@/server/followups";
import { listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { createTemplateAction } from "../../followup-actions";
import { TemplateForm } from "../followup-ui";

export default async function NuevaPlantillaPage() {
  const { user, active } = await requireActiveAgency();
  const [stages, settings] = await withUser(getDb(), user, (tx) => Promise.all([listStages(tx, user.id, active.agencyId), getSettings(tx, user.id, active.agencyId)]));
  const isAdmin = can(active.role, "followups.manage");
  const personal = !isAdmin && active.role === "asesor" && settings.allowPersonalTemplates;
  if (!isAdmin && !personal) redirect("/app/seguimientos?error=permission_denied");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="repeat" title={personal ? "Nueva plantilla personal" : "Nueva plantilla"}>
        <p className="text-sm text-slate-600">Después de crearla agregas los pasos.{personal && " Solo se aplica a las oportunidades de las que eres responsable."}</p>
      </PageHeader>
      <TemplateForm action={createTemplateAction} stages={stages} personal={personal} submit="Crear plantilla" />
    </div>
  );
}
