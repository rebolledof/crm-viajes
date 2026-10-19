import Link from "next/link";
import { Notice, buttonClass, linkButtonClass } from "@/components/ui";
import { ERROR_MESSAGES, isErrorCode } from "@/server/errors";
import { getSessionUser } from "@/server/session";
import { acceptInvitationAction } from "../../app/actions";

export default async function InvitacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const user = await getSessionUser();
  const here = `/invitacion/${encodeURIComponent(token)}`;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold text-slate-900">Invitación a una agencia</h1>
      {isErrorCode(sp.error) && <Notice tone="error">{ERROR_MESSAGES[sp.error]}</Notice>}
      {user ? (
        <form action={acceptInvitationAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-slate-600">
            Aceptarás la invitación con <strong>{user.email}</strong>. Debe ser el mismo correo al que llegó la invitación.
          </p>
          <button className={buttonClass}>Aceptar invitación</button>
        </form>
      ) : (
        <p className="text-sm text-slate-600">
          Para aceptarla,{" "}
          <Link className={linkButtonClass} href={`/login?next=${encodeURIComponent(here)}`}>inicia sesión</Link> o{" "}
          <Link className={linkButtonClass} href={`/registro?next=${encodeURIComponent(here)}`}>crea una cuenta</Link> con el correo invitado.
        </p>
      )}
    </main>
  );
}
