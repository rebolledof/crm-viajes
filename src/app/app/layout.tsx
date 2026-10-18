import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE_LABELS, can } from "@/domain/permissions";
import { getAppContext } from "@/server/session";
import { signOutAction } from "../(auth)/actions";
import { switchAgencyAction } from "./actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, memberships, active } = await getAppContext();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/app" className="font-semibold text-slate-900">
            CRM Viajes
          </Link>
          {active && (
            <nav className="flex gap-4 text-sm text-slate-700">
              <Link href="/app" className="hover:text-sky-700">Inicio</Link>
              {can(active.role, "team.manage") && <Link href="/app/equipo" className="hover:text-sky-700">Equipo</Link>}
              {can(active.role, "audit.read") && <Link href="/app/auditoria" className="hover:text-sky-700">Auditoría</Link>}
            </nav>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            {memberships.length > 1 && active && (
              <form action={switchAgencyAction} className="flex items-center gap-2">
                <label htmlFor="agencyId" className="sr-only">Agencia activa</label>
                <select id="agencyId" name="agencyId" defaultValue={active.agencyId} className="rounded-md border border-slate-300 px-2 py-1">
                  {memberships.map((m) => (
                    <option key={m.agencyId} value={m.agencyId}>{m.agencyName}</option>
                  ))}
                </select>
                <button className="text-sky-700 hover:underline">Cambiar</button>
              </form>
            )}
            {active && <span className="text-slate-500">{ROLE_LABELS[active.role]}</span>}
            <span className="text-slate-600">{user.email}</span>
            <form action={signOutAction}>
              <button className="text-sky-700 hover:underline">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
