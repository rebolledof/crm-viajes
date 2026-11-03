import { firstParams } from "@/domain/params";
import { ActionForm, Input } from "@/components/form";
import { AUTH_MESSAGES } from "@/domain/auth-errors";
import { Field, Notice, buttonClass, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/session";
import { updatePasswordAction } from "../../(auth)/actions";

/** Elegir contraseña nueva; se llega con sesión desde el enlace de recuperación. */
export default async function ClavePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = firstParams(await searchParams);
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <PageHeader icon="key" title="Nueva contraseña">
        <p className="text-sm text-slate-600">Cuenta: {user.email}</p>
      </PageHeader>
      {sp.error && <Notice tone="error">{AUTH_MESSAGES[sp.error] ?? AUTH_MESSAGES.cambio}</Notice>}
      <ActionForm action={updatePasswordAction} className="flex flex-col gap-4">
        <Field label="Contraseña nueva">
          <Input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
        </Field>
        <Field label="Repítela">
          <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
        </Field>
        <button className={buttonClass}>Guardar contraseña</button>
      </ActionForm>
    </div>
  );
}
