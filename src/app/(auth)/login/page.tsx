import { firstParams } from "@/domain/params";
import Link from "next/link";
import { ActionForm, Input } from "@/components/form";
import { AUTH_MESSAGES } from "@/domain/auth-errors";
import { Field, Notice, buttonClass, linkButtonClass } from "@/components/ui";
import { safeNext } from "@/lib/supabase/env";
import { signInAction } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = firstParams(await searchParams);
  const next = safeNext(sp.next);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-slate-900">Iniciar sesión</h1>
      {sp.error && <Notice tone="error">{AUTH_MESSAGES[sp.error] ?? "No se pudo iniciar sesión."}</Notice>}
      {sp.aviso === "confirma" && <Notice>Te enviamos un correo para confirmar tu cuenta. Ábrelo y vuelve aquí.</Notice>}
      <ActionForm action={signInAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Correo">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Contraseña">
          <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
        </Field>
        <button className={buttonClass}>Entrar</button>
      </ActionForm>
      <p className="text-sm">
        <Link className={linkButtonClass} href="/recuperar">Olvidé mi contraseña</Link>
      </p>
      <p className="text-sm text-slate-600">
        ¿No tienes cuenta?{" "}
        <Link className={linkButtonClass} href={`/registro?next=${encodeURIComponent(next)}`}>
          Crear cuenta
        </Link>
      </p>
    </main>
  );
}
