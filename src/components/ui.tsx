import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: ReactNode }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-slate-800",
    error: "border-red-200 bg-red-50 text-red-900",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded border px-3 py-2 text-sm ${styles}`}>
      {children}
    </p>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // Si el campo de adentro es obligatorio, la etiqueta muestra un asterisco rojo (regla de usabilidad).
    <label className="group flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700 group-has-[:required]:after:ml-0.5 group-has-[:required]:after:text-red-700 group-has-[:required]:after:content-['*']">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "rounded border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-brand";
export const buttonClass =
  "inline-flex items-center justify-center gap-1.5 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-contrast hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded border border-slate-300 bg-surface px-4 py-2 text-sm font-medium text-brand-text hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50";
export const linkButtonClass = "text-sm font-medium text-brand-text underline-offset-2 hover:underline";

/** Tarjeta del estilo A: borde fino, esquinas casi rectas y sombra suave. */
export function Card({ title, icon, actions, children, className = "", bodyClassName = "p-4", id }: { title?: ReactNode; icon?: IconName; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={`rounded border border-line bg-surface shadow-[0_2px_2px_rgba(0,0,0,0.05)] ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          {icon && <Icon name={icon} className="size-4 text-slate-500" />}
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2 text-sm font-normal">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Encabezado de página: ícono con el color de la agencia, título y acciones. */
export function PageHeader({ icon, eyebrow, title, actions, children }: { icon: IconName; eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3 shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded bg-brand text-brand-contrast" aria-hidden>
        <Icon name={icon} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="text-xs text-slate-600">{eyebrow}</div>}
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type ChipTone = "gray" | "red" | "amber" | "green" | "brand" | "accent" | "violet";

const CHIP_TONES: Record<ChipTone, string> = {
  gray: "bg-slate-100 text-slate-700",
  red: "bg-red-50 text-red-800",
  amber: "bg-amber-50 text-amber-900",
  green: "bg-emerald-50 text-emerald-800",
  brand: "bg-brand-soft text-brand-text",
  accent: "bg-accent-soft text-accent-text",
  violet: "bg-violet-50 text-violet-800",
};

export function Chip({ tone = "gray", icon, children, title }: { tone?: ChipTone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_TONES[tone]}`}>
      {icon && <Icon name={icon} className="size-3" />}
      {children}
    </span>
  );
}
