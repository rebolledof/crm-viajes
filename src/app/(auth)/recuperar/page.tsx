import Link from "next/link";
import { Field, Notice, buttonClass, inputClass, linkButtonClass } from "@/components/ui";
import { requestPasswordResetAction } from "../actions";

const ERRORS: Record<string, string> = {
  datos: "Escribe un correo válido.",
  limite_correos: "Se enviaron demasiados correos en poco tiempo. Espera una hora y vuelve a intentarlo.",
};

export default async function RecuperarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold text-slate-900">Recuperar contraseña</h1>
      {sp.error && <Notice tone="error">{ERRORS[sp.error] ?? "No se pudo enviar el correo."}</Notice>}
      {sp.enviado ? (
        <Notice tone="ok">Si hay una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva. Revisa también la carpeta de spam.</Notice>
      ) : (
        <form action={requestPasswordResetAction} className="flex flex-col gap-4">
          <Field label="Correo de tu cuenta">
            <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
          </Field>
          <button className={buttonClass}>Enviar enlace</button>
        </form>
      )}
      <p className="text-sm">
        <Link className={linkButtonClass} href="/login">Volver a iniciar sesión</Link>
      </p>
    </main>
  );
}
