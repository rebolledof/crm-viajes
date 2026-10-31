import Link from "next/link";
import { ActionForm, Input } from "@/components/form";
import { AUTH_MESSAGES } from "@/domain/auth-errors";
import { Field, Notice, buttonClass, linkButtonClass } from "@/components/ui";
import { safeNext } from "@/lib/supabase/env";
import { signUpAction } from "../actions";

export default async function RegistroPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold text-slate-900">Crear cuenta</h1>
      {sp.error && <Notice tone="error">{AUTH_MESSAGES[sp.error] ?? "No se pudo crear la cuenta."}</Notice>}
      <ActionForm action={signUpAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Correo">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Contraseña (mínimo 8 caracteres)">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
        </Field>
        <button className={buttonClass}>Crear cuenta</button>
      </ActionForm>
      <p className="text-sm text-slate-600">
        ¿Ya tienes cuenta?{" "}
        <Link className={linkButtonClass} href={`/login?next=${encodeURIComponent(next)}`}>
          Iniciar sesión
        </Link>
      </p>
    </main>
  );
}
