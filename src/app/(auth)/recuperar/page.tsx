import { firstParams } from "@/domain/params";
import Link from "next/link";
import { ActionForm, Input } from "@/components/form";
import { AUTH_MESSAGES } from "@/domain/auth-errors";
import { Field, Notice, buttonClass, linkButtonClass } from "@/components/ui";
import { requestPasswordResetAction } from "../actions";

export default async function RecuperarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = firstParams(await searchParams);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-slate-900">Recuperar contraseña</h1>
      {sp.error && <Notice tone="error">{AUTH_MESSAGES[sp.error] ?? "No se pudo enviar el correo."}</Notice>}
      {sp.enviado ? (
        <Notice tone="ok">Si hay una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva. Revisa también la carpeta de spam.</Notice>
      ) : (
        <ActionForm action={requestPasswordResetAction} className="flex flex-col gap-4">
          <Field label="Correo de tu cuenta">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <button className={buttonClass}>Enviar enlace</button>
        </ActionForm>
      )}
      <p className="text-sm">
        <Link className={linkButtonClass} href="/login">Volver a iniciar sesión</Link>
      </p>
    </main>
  );
}
