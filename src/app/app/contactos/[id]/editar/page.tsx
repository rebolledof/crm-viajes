import { redirect } from "next/navigation";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { getContactDetail } from "@/server/contacts";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { updateContactAction } from "../../../crm-actions";
import { ContactForm, Flash, loadOr404, type SearchParams } from "../../../crm-ui";

export default async function EditarContactoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const { id } = await params;
  if (!can(active.role, "crm.write")) redirect(`/app/contactos/${id}?error=permission_denied`);
  const sp = await searchParams;
  const [detail, members] = await loadOr404(id, () =>
    withUser(getDb(), user, (tx) => Promise.all([getContactDetail(tx, user.id, active.agencyId, id), activeMembers(tx, user.id, active.agencyId)])),
  );
  const c = detail.contact;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Editar {c.fullName}</h1>
      <Flash sp={sp} />
      <ContactForm
        action={updateContactAction}
        members={members}
        values={{ ...c, phones: detail.phones.map((p) => p.e164), emails: detail.emails.map((e) => e.email) }}
        submit="Guardar cambios"
      />
    </div>
  );
}
