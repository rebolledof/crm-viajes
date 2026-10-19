import { redirect } from "next/navigation";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { getOpportunity } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { updateOpportunityAction } from "../../../crm-actions";
import { Flash, OpportunityForm, loadOr404, type SearchParams } from "../../../crm-ui";

export default async function EditarOportunidadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const { id } = await params;
  if (!can(active.role, "crm.write")) redirect(`/app/oportunidades/${id}?error=permission_denied`);
  const sp = await searchParams;
  const [data, members] = await loadOr404(id, () =>
    withUser(getDb(), user, (tx) => Promise.all([getOpportunity(tx, user.id, active.agencyId, id), activeMembers(tx, user.id, active.agencyId)])),
  );
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Editar oportunidad de {data.contactName}</h1>
      <Flash sp={sp} />
      <OpportunityForm action={updateOpportunityAction} members={members} values={data.opp} submit="Guardar cambios" />
    </div>
  );
}
