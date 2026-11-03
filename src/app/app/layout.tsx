import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { getDb, withUser } from "@/db/client";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, agencyInitials, brandCssVars, cssBlock } from "@/domain/branding";
import { ROLE_LABELS, can } from "@/domain/permissions";
import { NAV_LAYOUT_LABELS, THEME_LABELS, themeClass, type NavLayout, type Preferences, type Theme } from "@/domain/preferences";
import { getBranding, getPreferences, type Branding } from "@/server/branding";
import { getAppContext } from "@/server/session";
import { inboxCounts } from "@/server/inbox";
import { dueTodayCount } from "@/server/tasks";
import { signOutAction } from "../(auth)/actions";
import { switchAgencyAction } from "./actions";
import { setPreferenceAction } from "./branding-actions";
import { DrawerLinks, Dropdown, SideLinks, TopTabs, type NavItem } from "./shell/nav-links";

/**
 * Marco del área /app (SPEC-002c): estilo A con la marca de la agencia activa y las preferencias
 * de la persona (menú arriba o a la izquierda, comprimido, tema). Todo se decide en el servidor,
 * así que la página llega ya con su tema y su menú, sin parpadeo.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, memberships, active } = await getAppContext();
  const db = getDb();
  const [prefs, branding, due, inbox] = await withUser(db, user, async (tx) =>
    Promise.all([
      getPreferences(tx, user.id),
      active ? getBranding(tx, user.id, active.agencyId) : Promise.resolve<Branding>({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT, hasLogo: false, version: 0 }),
      active ? dueTodayCount(tx, user.id, active.agencyId, new Date()) : Promise.resolve(0),
      // SPEC-003: número rojo con las conversaciones sin responder que me tocan (mías o sin asignar).
      active ? inboxCounts(tx, user.id, active.agencyId, new Date()).then((c) => c.unansweredMine) : Promise.resolve(0),
    ]),
  );
  const vars = brandCssVars(branding);
  const css = [cssBlock(":root", vars.light), cssBlock(".dark", vars.dark), `@media (prefers-color-scheme: dark){${cssBlock(".theme-system", vars.dark)}}`].join("");
  const theme = themeClass(prefs.theme);

  const main: NavItem[] = active
    ? [
        { href: "/app", label: "Mi día", icon: "home", badge: due || undefined },
        { href: "/app/bandeja", label: "Bandeja", icon: "inbox", badge: inbox || undefined, badgeTone: "alert", badgeLabel: "sin responder" },
        { href: "/app/contactos", label: "Contactos", icon: "users" },
        { href: "/app/oportunidades", label: "Oportunidades", icon: "kanban" },
        { href: "/app/tareas", label: "Tareas", icon: "check" },
        { href: "/app/seguimientos", label: "Seguimientos", icon: "repeat" },
      ]
    : [];
  const admin: NavItem[] = active
    ? [
        ...(can(active.role, "pipeline.manage") ? [{ href: "/app/embudo", label: "Etapas del embudo", icon: "sliders" } as NavItem] : []),
        ...(can(active.role, "team.manage") ? [{ href: "/app/equipo", label: "Equipo", icon: "users" } as NavItem] : []),
        ...(can(active.role, "audit.read") ? [{ href: "/app/auditoria", label: "Auditoría", icon: "shield" } as NavItem] : []),
        ...(can(active.role, "inbox.manage") ? [{ href: "/app/configuracion/canales", label: "Canales de entrada", icon: "form" } as NavItem] : []),
        ...(can(active.role, "agency.update") ? [{ href: "/app/configuracion/marca", label: "Marca de la agencia", icon: "palette" } as NavItem] : []),
      ]
    : [];

  const logo = <AgencyLogo name={active?.agencyName ?? "CRM Viajes"} branding={branding} hasAgency={!!active} />;
  const userMenu = <UserMenu email={user.email} roleLabel={active ? ROLE_LABELS[active.role] : null} agencyName={active?.agencyName ?? null} memberships={memberships} activeId={active?.agencyId ?? null} prefs={prefs} />;
  const search = active ? <GlobalSearch /> : null;
  const side = prefs.navLayout === "side";

  return (
    <div className={`${theme} min-h-screen bg-canvas text-slate-900`}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      {side ? (
        <div className="flex min-h-screen">
          <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface shadow-[2px_0_3px_rgba(0,0,0,0.04)] md:flex ${prefs.navCollapsed ? "w-[68px]" : "w-60"}`}>
            <div className={`flex h-[60px] items-center border-b-[3px] border-brand ${prefs.navCollapsed ? "justify-center" : "px-4"}`}>
              <Link href="/app" className="min-w-0">
                {prefs.navCollapsed ? <AgencyMark name={active?.agencyName ?? "CRM"} branding={branding} hasAgency={!!active} size="lg" /> : logo}
              </Link>
            </div>
            <nav aria-label="Principal" className="mt-2 flex flex-1 flex-col overflow-y-auto">
              <SideLinks items={main} collapsed={prefs.navCollapsed} />
              {admin.length > 0 && (
                <>
                  <p className={prefs.navCollapsed ? "mx-4 mt-3 mb-1 border-t border-slate-100" : "px-5 pt-4 pb-1.5 text-[11px] font-semibold tracking-wide text-slate-600 uppercase"}>
                    {prefs.navCollapsed ? <span className="sr-only">Administración</span> : "Administración"}
                  </p>
                  <SideLinks items={admin} collapsed={prefs.navCollapsed} />
                </>
              )}
            </nav>
            <form action={setPreferenceAction} className="border-t border-slate-100">
              <input type="hidden" name="navCollapsed" value={prefs.navCollapsed ? "false" : "true"} />
              <button className={`flex w-full items-center gap-2.5 py-3 text-sm text-slate-600 hover:bg-slate-50 ${prefs.navCollapsed ? "justify-center" : "px-4"}`} aria-label={prefs.navCollapsed ? "Expandir menú" : "Comprimir menú"} title={prefs.navCollapsed ? "Expandir menú" : undefined}>
                <Icon name={prefs.navCollapsed ? "right" : "left"} className="size-[18px]" />
                {!prefs.navCollapsed && "Comprimir menú"}
              </button>
            </form>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-line bg-surface px-4">
              <MobileDrawer items={[...main, ...admin]} />
              <Link href="/app" className="min-w-0 md:hidden">{logo}</Link>
              <div className="hidden flex-1 md:block">{search}</div>
              <div className="ml-auto flex items-center gap-2">{userMenu}</div>
            </header>
            <main id="contenido" className="flex w-full flex-1 flex-col gap-3 px-4 py-4 md:px-5">{children}</main>
          </div>
        </div>
      ) : (
        <>
          <header className="sticky top-0 z-20 bg-surface shadow-[0_2px_3px_rgba(0,0,0,0.06)]">
            <div className="flex h-[52px] items-center gap-3 border-b border-line px-4 md:px-5">
              <MobileDrawer items={[...main, ...admin]} />
              <Link href="/app" className="min-w-0">{logo}</Link>
              <div className="mx-auto hidden w-full max-w-xl md:block">{search}</div>
              <div className="ml-auto flex items-center gap-2 md:ml-0">{userMenu}</div>
            </div>
            {active && (
              <div className="hidden h-[42px] items-stretch border-b-[3px] border-brand px-4 md:flex md:px-5">
                <TopTabs items={main} more={admin} />
              </div>
            )}
          </header>
          <main id="contenido" className="flex w-full flex-1 flex-col gap-3 px-4 py-4 md:px-5">{children}</main>
        </>
      )}
    </div>
  );
}

function AgencyMark({ name, branding, hasAgency, size = "md" }: { name: string; branding: Branding; hasAgency: boolean; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-10" : "size-8";
  if (hasAgency && branding.hasLogo) {
    // eslint-disable-next-line @next/next/no-img-element -- imagen servida por la propia app con RLS; no pasa por el optimizador
    return <img src={`/app/marca/logo?v=${branding.version}`} alt={`Logo de ${name}`} className={`${box} shrink-0 rounded object-contain`} />;
  }
  return (
    <span aria-hidden className={`${box} flex shrink-0 items-center justify-center rounded bg-brand text-sm font-bold text-brand-contrast`}>
      {agencyInitials(name)}
    </span>
  );
}

function AgencyLogo({ name, branding, hasAgency }: { name: string; branding: Branding; hasAgency: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <AgencyMark name={name} branding={branding} hasAgency={hasAgency} />
      <span className="truncate font-bold tracking-tight text-slate-900">{name}</span>
    </span>
  );
}

function GlobalSearch() {
  return (
    <form role="search" action="/app/contactos" className="flex items-center gap-2 rounded border border-slate-300 bg-surface px-3 text-sm text-slate-500 focus-within:outline-2 focus-within:outline-brand">
      <Icon name="search" className="size-4" />
      <label htmlFor="buscar-global" className="sr-only">Buscar contactos</label>
      <input id="buscar-global" name="q" type="search" maxLength={100} placeholder="Buscar contactos por nombre, teléfono o correo" className="w-full bg-transparent py-1.5 text-slate-900 outline-none placeholder:text-slate-500" />
    </form>
  );
}

function MobileDrawer({ items }: { items: NavItem[] }) {
  if (!items.length) return null;
  return (
    <Dropdown
      className="md:hidden"
      label="Abrir menú"
      summaryClassName="flex size-9 cursor-pointer items-center justify-center rounded text-slate-700 hover:bg-slate-100"
      summary={<Icon name="menu" className="size-5" />}
      panelClassName="left-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)]"
    >
      <nav aria-label="Principal">
        <DrawerLinks items={items} />
      </nav>
    </Dropdown>
  );
}

const optionClass = "flex flex-1 flex-col items-center gap-1 rounded border-2 px-2 py-2 text-xs font-medium";
const optionOn = "border-brand bg-brand-softer text-brand-text";
const optionOff = "border-slate-200 text-slate-700 hover:bg-slate-50";

function UserMenu({
  email,
  roleLabel,
  agencyName,
  memberships,
  activeId,
  prefs,
}: {
  email: string;
  roleLabel: string | null;
  agencyName: string | null;
  memberships: { agencyId: string; agencyName: string }[];
  activeId: string | null;
  prefs: Preferences;
}) {
  const layouts: { value: NavLayout; icon: "layoutTop" | "layoutSide" }[] = [
    { value: "top", icon: "layoutTop" },
    { value: "side", icon: "layoutSide" },
  ];
  const themes: { value: Theme; icon: "sun" | "moon" | "monitor" }[] = [
    { value: "light", icon: "sun" },
    { value: "dark", icon: "moon" },
    { value: "system", icon: "monitor" },
  ];
  return (
    <Dropdown
      label="Tu cuenta y preferencias"
      summaryClassName="flex cursor-pointer items-center rounded-full outline-offset-2 hover:ring-2 hover:ring-brand-line"
      summary={
        <span className="flex size-8 items-center justify-center rounded-full bg-indigo-500 text-xs font-semibold text-white">{email.slice(0, 2).toUpperCase()}</span>
      }
      panelClassName="right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-2rem)] text-sm"
    >
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="truncate font-semibold text-slate-900">{email}</p>
        {roleLabel && agencyName && <p className="text-xs text-slate-600">{roleLabel} · {agencyName}</p>}
      </div>
      {memberships.length > 1 && activeId && (
        <form action={switchAgencyAction} className="flex items-end gap-2 border-b border-slate-100 px-4 py-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-semibold text-slate-900">Agencia activa</span>
            <select name="agencyId" defaultValue={activeId} className="rounded border border-slate-300 bg-surface px-2 py-1.5 text-slate-900">
              {memberships.map((m) => (
                <option key={m.agencyId} value={m.agencyId}>{m.agencyName}</option>
              ))}
            </select>
          </label>
          <button className="rounded border border-slate-300 px-3 py-1.5 font-medium text-brand-text hover:bg-slate-50">Cambiar</button>
        </form>
      )}
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="font-semibold text-slate-900">Ubicación del menú</p>
        <p className="mb-2 text-xs text-slate-600">Solo cambia para ti.</p>
        <div className="flex gap-2">
          {layouts.map((l) => (
            <form key={l.value} action={setPreferenceAction} className="flex flex-1">
              <input type="hidden" name="navLayout" value={l.value} />
              <button aria-pressed={prefs.navLayout === l.value} className={`${optionClass} ${prefs.navLayout === l.value ? optionOn : optionOff}`}>
                <Icon name={l.icon} className="size-5" />
                {NAV_LAYOUT_LABELS[l.value]}
              </button>
            </form>
          ))}
        </div>
        {prefs.navLayout === "side" && (
          <form action={setPreferenceAction} className="mt-2">
            <input type="hidden" name="navCollapsed" value={prefs.navCollapsed ? "false" : "true"} />
            <button className="flex items-center gap-2 text-left text-slate-700" aria-pressed={prefs.navCollapsed}>
              <span className={`flex size-4 items-center justify-center rounded border-2 ${prefs.navCollapsed ? "border-brand bg-brand text-brand-contrast" : "border-slate-400"}`}>
                {prefs.navCollapsed && <Icon name="done" className="size-3" />}
              </span>
              Menú comprimido (solo íconos)
            </button>
          </form>
        )}
      </div>
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="mb-2 font-semibold text-slate-900">Tema</p>
        <div className="flex gap-2">
          {themes.map((t) => (
            <form key={t.value} action={setPreferenceAction} className="flex flex-1">
              <input type="hidden" name="theme" value={t.value} />
              <button aria-pressed={prefs.theme === t.value} className={`${optionClass} ${prefs.theme === t.value ? optionOn : optionOff}`}>
                <Icon name={t.icon} className="size-4" />
                {THEME_LABELS[t.value]}
              </button>
            </form>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-600">Automático sigue el modo de tu computador o celular.</p>
      </div>
      <Link href="/app/clave" className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-slate-700 hover:bg-slate-50">
        <Icon name="key" className="size-4 text-slate-500" /> Cambiar contraseña
      </Link>
      <form action={signOutAction}>
        <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-red-700 hover:bg-slate-50">
          <Icon name="logout" className="size-4" /> Cerrar sesión
        </button>
      </form>
    </Dropdown>
  );
}

