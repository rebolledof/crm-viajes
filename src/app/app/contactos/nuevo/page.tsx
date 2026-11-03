import Link from "next/link";
import { PageHeader, linkButtonClass } from "@/components/ui";
import { firstParams } from "@/domain/params";
import { redirect } from "next/navigation";
import { getDb, withUser } from "@/db/client";
import { can } from "@/domain/permissions";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { createContactAction } from "../../crm-actions";
import { ContactForm, Flash, type SearchParams } from "../../crm-ui";

export default async function NuevoContactoPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "crm.write")) redirect("/app/contactos?error=permission_denied");
  const sp = firstParams(await searchParams);
  const members = await withUser(getDb(), user, (tx) => activeMembers(tx, user.id, active.agencyId));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="users" eyebrow={<Link href="/app/contactos" className={linkButtonClass}>Contactos</Link>} title="Nuevo contacto" />
      <Flash sp={sp} />
      <ContactForm action={createContactAction} members={members} values={{ ownerId: user.id }} submit="Crear contacto" />
    </div>
  );
}
