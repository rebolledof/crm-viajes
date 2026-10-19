import Link from "next/link";
import { Field, Notice, buttonClass, inputClass, linkButtonClass } from "@/components/ui";
import { safeNext } from "@/lib/supabase/env";
import { signInAction } from "../actions";

const ERRORS: Record<string, string> = {
  credenciales: "El correo o la contraseña no coinciden.",
  datos: "Escribe un correo válido y una contraseña de al menos 8 caracteres.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold text-slate-900">Iniciar sesión</h1>
      {sp.error && <Notice tone="error">{ERRORS[sp.error] ?? "No se pudo iniciar sesión."}</Notice>}
      {sp.aviso === "confirma" && <Notice>Te enviamos un correo para confirmar tu cuenta. Ábrelo y vuelve aquí.</Notice>}
      <form action={signInAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Correo">
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Field label="Contraseña">
          <input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} className={inputClass} />
        </Field>
        <button className={buttonClass}>Entrar</button>
      </form>
      <p className="text-sm text-slate-600">
        ¿No tienes cuenta?{" "}
        <Link className={linkButtonClass} href={`/registro?next=${encodeURIComponent(next)}`}>
          Crear cuenta
        </Link>
      </p>
    </main>
  );
}
