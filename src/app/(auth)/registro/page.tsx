import Link from "next/link";
import { Field, Notice, buttonClass, inputClass, linkButtonClass } from "@/components/ui";
import { safeNext } from "@/lib/supabase/env";
import { signUpAction } from "../actions";

const ERRORS: Record<string, string> = {
  datos: "Escribe un correo válido y una contraseña de 8 a 72 caracteres.",
  registro: "No se pudo crear la cuenta. Si ya tienes una, inicia sesión.",
};

export default async function RegistroPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold text-slate-900">Crear cuenta</h1>
      {sp.error && <Notice tone="error">{ERRORS[sp.error] ?? "No se pudo crear la cuenta."}</Notice>}
      <form action={signUpAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Correo">
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Field label="Contraseña (mínimo 8 caracteres)">
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} className={inputClass} />
        </Field>
        <button className={buttonClass}>Crear cuenta</button>
      </form>
      <p className="text-sm text-slate-600">
        ¿Ya tienes cuenta?{" "}
        <Link className={linkButtonClass} href={`/login?next=${encodeURIComponent(next)}`}>
          Iniciar sesión
        </Link>
      </p>
    </main>
  );
}
