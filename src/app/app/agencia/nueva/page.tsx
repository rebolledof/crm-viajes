import { getDb, withUser } from "@/db/client";
import { firstParams } from "@/domain/params";
import { ActionForm, Input } from "@/components/form";
import { Field, Notice, buttonClass } from "@/components/ui";
import { myRevokedAccess } from "@/server/agencies";
import { ERROR_MESSAGES, isErrorCode } from "@/server/errors";
import { getAppContext } from "@/server/session";
import { createAgencyAction } from "../../actions";

const dateFmt = new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "America/Bogota" });

export default async function NuevaAgenciaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = firstParams(await searchParams);
  const { user, memberships } = await getAppContext();
  // Sin ninguna agencia activa y con un acceso retirado: no entra ni crea una propia (informe S04).
  const revoked = memberships.length ? [] : await withUser(getDb(), user, (tx) => myRevokedAccess(tx));
  if (revoked.length) {
    const names = [...new Set(revoked.map((r) => r.agencyName))];
    return (
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <h1 className="text-2xl font-semibold text-slate-900">Tu acceso fue retirado</h1>
        <Notice tone="error">
          Un administrador retiró tu acceso a {names.join(", ")} el {dateFmt.format(revoked[0].revokedAt)}. Ya no puedes ver la información de esa agencia.
        </Notice>
        <div className="flex flex-col gap-2 text-sm text-slate-700">
          <p className="font-medium text-slate-900">Para volver a entrar</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Pide al administrador de la agencia una invitación nueva para {user.email}.</li>
            <li>Abre el enlace de la invitación que te llegue por correo y acéptala.</li>
          </ol>
          <p>Si crees que es un error, habla con el administrador de tu agencia.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Crea tu agencia</h1>
      <p className="text-sm text-slate-600">
        Quedarás como administrador y podrás invitar a tu equipo. Si te invitaron a una agencia existente, abre el enlace de la invitación.
      </p>
      {isErrorCode(sp.error) && <Notice tone="error">{ERROR_MESSAGES[sp.error]}</Notice>}
      <ActionForm action={createAgencyAction} className="flex flex-col gap-4">
        <Field label="Nombre de la agencia">
          <Input id="name" name="name" required minLength={2} maxLength={120} placeholder="Viajes del Caribe" />
        </Field>
        <button className={buttonClass}>Crear agencia</button>
      </ActionForm>
    </div>
  );
}
