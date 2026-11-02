import { firstParams } from "@/domain/params";
import { ActionForm, Input } from "@/components/form";
import { Field, Notice, buttonClass } from "@/components/ui";
import { ERROR_MESSAGES, isErrorCode } from "@/server/errors";
import { createAgencyAction } from "../../actions";

export default async function NuevaAgenciaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = firstParams(await searchParams);
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
