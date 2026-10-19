import Link from "next/link";
import { redirect } from "next/navigation";
import { linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { getContactDetail } from "@/server/contacts";
import { listStages } from "@/server/opportunities";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { createOpportunityAction } from "../../crm-actions";
import { Flash, OpportunityForm, loadOr404, type SearchParams } from "../../crm-ui";

export default async function NuevaOportunidadPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = await searchParams;
  const contactId = sp.contactId ?? "";
  if (!can(active.role, "crm.write")) redirect("/app/oportunidades?error=permission_denied");
  const [detail, stages, members] = await loadOr404(contactId, () =>
    withUser(getDb(), user, (tx) =>
      Promise.all([getContactDetail(tx, user.id, active.agencyId, contactId), listStages(tx, user.id, active.agencyId), activeMembers(tx, user.id, active.agencyId)]),
    ),
  );
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm"><Link href={`/app/contactos/${contactId}`} className={linkButtonClass}>{detail.contact.fullName}</Link></p>
        <h1 className="text-2xl font-semibold text-slate-900">Nueva oportunidad</h1>
      </div>
      <Flash sp={sp} />
      <OpportunityForm
        action={createOpportunityAction}
        members={members}
        stages={stages.filter((s) => s.kind === "abierta")}
        values={{ contactId, ownerId: detail.contact.ownerId ?? user.id }}
        submit="Crear oportunidad"
      />
    </div>
  );
}
