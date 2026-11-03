import { Icon } from "@/components/icons";
import type { PathItem } from "@/domain/guide";

/**
 * Camino de etapas (RF-246): flechas encadenadas como en los CRM grandes. Las etapas hechas van
 * en verde con un chulo, la actual con el color de la agencia y las que faltan en gris.
 */
export function StagePath({ items, compact }: { items: PathItem[]; compact?: boolean }) {
  return (
    <ol aria-label="Camino de etapas" className="relative flex w-full overflow-x-auto">
      {items.map((s, i) => {
        const tone =
          s.closed === "perdida"
            ? "bg-red-700 text-white"
            : s.closed === "ganada"
              ? "bg-emerald-700 text-white"
              : s.state === "actual"
                ? "bg-brand text-brand-contrast font-semibold"
                : s.state === "hecho"
                  ? "bg-emerald-100 text-emerald-900"
                  : "bg-slate-200 text-slate-700";
        return (
          <li
            key={s.id}
            title={s.name}
            aria-current={s.state === "actual" ? "step" : undefined}
            className={`${i === 0 ? "chevron-first" : "chevron -ml-2"} flex min-w-[96px] flex-1 items-center justify-center gap-1 px-5 text-center text-xs ${compact ? "h-7" : "h-9 sm:text-sm"} ${tone}`}
          >
            {s.state === "hecho" && !s.closed && <Icon name="done" className="size-3.5" />}
            <span className="truncate">{s.name}</span>
            <span className="sr-only">{s.state === "actual" ? " (etapa actual)" : s.state === "hecho" ? " (hecha)" : " (pendiente)"}</span>
          </li>
        );
      })}
    </ol>
  );
}
