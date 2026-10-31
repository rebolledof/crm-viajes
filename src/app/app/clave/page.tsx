import { Field, Notice, buttonClass, inputClass } from "@/components/ui";
import { requireUser } from "@/server/session";
import { updatePasswordAction } from "../../(auth)/actions";

const ERRORS: Record<string, string> = {
  datos: "La contraseña debe tener de 8 a 72 caracteres.",
  distintas: "Las dos contraseñas no coinciden.",
  clave_debil: "La contraseña es muy fácil de adivinar. Usa una más larga, con letras y números.",
  igual: "La contraseña nueva debe ser distinta de la anterior.",
  cambio: "No se pudo cambiar la contraseña. Pide un enlace nuevo e inténtalo otra vez.",
};

/** Elegir contraseña nueva; se llega con sesión desde el enlace de recuperación. */
export default async function ClavePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Nueva contraseña</h1>
      <p className="text-sm text-slate-600">Cuenta: {user.email}</p>
      {sp.error && <Notice tone="error">{ERRORS[sp.error] ?? ERRORS.cambio}</Notice>}
      <form action={updatePasswordAction} className="flex flex-col gap-4">
        <Field label="Contraseña nueva">
          <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} className={inputClass} />
        </Field>
        <Field label="Repítela">
          <input name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} className={inputClass} />
        </Field>
        <button className={buttonClass}>Guardar contraseña</button>
      </form>
    </div>
  );
}
