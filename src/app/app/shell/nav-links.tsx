"use client";

// Enlaces del menú con la pestaña activa marcada. Es de cliente solo para saber la ruta actual.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export type NavItem = { href: string; label: string; icon: IconName; badge?: number; badgeTone?: "alert"; badgeLabel?: string };

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Menú horizontal del estilo A: pestañas con el acento de la agencia bajo la activa. */
export function TopTabs({ items, more }: { items: NavItem[]; more: NavItem[] }) {
  const pathname = usePathname();
  const moreActive = more.some((i) => isActive(pathname, i.href));
  return (
    <nav aria-label="Principal" className="flex items-stretch gap-1">
      {items.map((i) => {
        const on = isActive(pathname, i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-[3px] flex items-center gap-2 border-b-[3px] px-3.5 text-sm ${on ? "border-accent bg-brand-softer font-semibold text-slate-900" : "border-transparent text-slate-700 hover:bg-slate-50"}`}
          >
            {i.label}
            {i.badge ? <Badge n={i.badge} tone={i.badgeTone} label={i.badgeLabel} /> : null}
          </Link>
        );
      })}
      {more.length > 0 && (
        <Dropdown
          className="-mb-[3px] flex"
          summaryClassName={`flex h-full cursor-pointer items-center gap-1 border-b-[3px] px-3.5 text-sm ${moreActive ? "border-accent bg-brand-softer font-semibold text-slate-900" : "border-transparent text-slate-700 hover:bg-slate-50"}`}
          summary={
            <>
              Administración <Icon name="down" className="size-3.5" />
            </>
          }
          panelClassName="left-0 top-full mt-1 w-56"
        >
          <ul className="py-1">
            {more.map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={isActive(pathname, i.href) ? "page" : undefined} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 aria-[current=page]:font-semibold aria-[current=page]:text-brand-text">
                  <Icon name={i.icon} className="size-4 text-slate-500" />
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </Dropdown>
      )}
    </nav>
  );
}

/** Menú lateral: abierto (ícono y nombre) o comprimido (solo ícono; el nombre sale al pasar el mouse). */
export function SideLinks({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col">
      {items.map((i) => {
        const on = isActive(pathname, i.href);
        return (
          <li key={i.href} className="group relative">
            <Link
              href={i.href}
              aria-current={on ? "page" : undefined}
              aria-label={collapsed ? i.label : undefined}
              className={`relative flex items-center gap-3 border-l-[3px] text-sm ${collapsed ? "justify-center py-3" : "px-4 py-2.5"} ${on ? "border-accent bg-brand-softer font-semibold text-brand-text" : "border-transparent text-slate-700 hover:bg-slate-50"}`}
            >
              <Icon name={i.icon} className={`size-[18px] ${on ? "text-brand-text" : "text-slate-500"}`} />
              {!collapsed && <span className="flex-1">{i.label}</span>}
              {i.badge ? <Badge n={i.badge} floating={collapsed} tone={i.badgeTone} label={i.badgeLabel} /> : null}
            </Link>
            {collapsed && (
              <span role="tooltip" className="pointer-events-none absolute top-1/2 left-full z-30 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg group-focus-within:block group-hover:block dark:bg-slate-700 dark:text-slate-50">
                {i.label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Lista simple para el cajón del celular. */
export function DrawerLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col py-1">
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href} aria-current={isActive(pathname, i.href) ? "page" : undefined} className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 aria-[current=page]:bg-brand-softer aria-[current=page]:font-semibold aria-[current=page]:text-brand-text">
            <Icon name={i.icon} className="size-[18px] text-slate-500" />
            <span className="flex-1">{i.label}</span>
            {i.badge ? <Badge n={i.badge} tone={i.badgeTone} label={i.badgeLabel} /> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Badge({ n, floating, tone, label = "pendientes" }: { n: number; floating?: boolean; tone?: "alert"; label?: string }) {
  return (
    <span
      aria-label={`${n} ${label}`}
      className={`rounded-full px-1.5 text-[11px] leading-[18px] font-bold ${tone === "alert" ? "bg-red-600 text-white" : "bg-accent text-accent-contrast"} ${floating ? "absolute top-1 right-3" : ""}`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Menú desplegable con <details>: funciona sin JavaScript y, con él, se cierra al hacer clic
 * fuera, al pulsar Escape o al navegar.
 */
export function Dropdown({ summary, summaryClassName, panelClassName = "", className = "", label, children }: { summary: ReactNode; summaryClassName?: string; panelClassName?: string; className?: string; label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className={`relative ${className}`}>
      <summary aria-label={label} className={`menu-summary ${summaryClassName ?? ""}`}>{summary}</summary>
      <div className={`absolute z-40 rounded border border-line bg-surface shadow-[0_10px_30px_rgba(0,0,0,0.18)] ${panelClassName}`}>{children}</div>
    </details>
  );
}
