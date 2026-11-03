import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

/**
 * Pantallas de acceso con el estilo A (SPEC-002c, alcance 6): fondo gris y tarjeta blanca. Aún no
 * se sabe la agencia, así que van con los colores de fábrica y sin logo de agencia.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-4 py-10">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <span className="flex size-8 items-center justify-center rounded bg-brand text-brand-contrast" aria-hidden>
          <Icon name="plane" className="size-4" />
        </span>
        CRM de viajes
      </p>
      <div className="w-full max-w-sm rounded border border-line bg-surface px-6 py-8 shadow-[0_2px_2px_rgba(0,0,0,0.05)]">{children}</div>
    </div>
  );
}
