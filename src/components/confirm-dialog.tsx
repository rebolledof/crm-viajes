"use client";

// Confirmación de una acción que no se puede deshacer (regla de usabilidad): un botón abre una
// ventana con lo que va a pasar y el botón que lo hace. Escape o "Cancelar" la cierran.
import { useId, useRef, type ReactNode } from "react";

export function ConfirmDialog({
  trigger,
  triggerClassName,
  title,
  children,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  /** Contenido de la ventana: el detalle y el formulario con el botón que confirma. */
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded border border-line bg-surface p-0 text-slate-800 shadow-xl backdrop:bg-slate-900/40"
        onClick={(e) => {
          // Un clic fuera de la ventana (en el fondo) la cierra.
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>
          {children}
        </div>
      </dialog>
    </>
  );
}

/** Botón "Cancelar" que cierra la ventana en la que está. */
export function CancelDialogButton({ className, children = "Cancelar" }: { className?: string; children?: ReactNode }) {
  return (
    <button type="button" className={className} onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
      {children}
    </button>
  );
}
