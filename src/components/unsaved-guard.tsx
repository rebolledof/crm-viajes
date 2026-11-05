"use client";

// Avisa antes de perder lo escrito en un formulario que todavía no se guardó (prueba
// independiente de la parte 2 del cotizador, 5 nov 2026): al cerrar o recargar la pestaña, y al
// tocar un enlace de la app. Guardar con un botón del formulario no pregunta.
import { useEffect } from "react";
import { useFormStatus } from "react-dom";

const MESSAGE = "Tienes cambios sin guardar en esta cotización. Si sales ahora se pierden. ¿Salir de todos modos?";

export function UnsavedGuard({ formId }: { formId: string }) {
  useEffect(() => {
    let dirty = false;
    const form = () => document.getElementById(formId) as HTMLFormElement | null;
    const markDirty = (e: Event) => {
      const f = form();
      if (f && e.target instanceof Node && f.contains(e.target)) dirty = true;
    };
    const markButton = (e: Event) => {
      const t = e.target instanceof Element ? e.target.closest("button") : null;
      if (t && t.type === "button" && form()?.contains(t)) dirty = true;
    };
    const onSubmit = (e: Event) => {
      if (e.target === form()) dirty = false;
    };
    const onLink = (e: MouseEvent) => {
      if (!dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!a || a.getAttribute("target") === "_blank") return;
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      } else dirty = false;
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // El formulario se vuelve a montar tras un rechazo del servidor: lo escrito sigue sin guardar.
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("click", markButton, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onLink, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("click", markButton, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onLink, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [formId]);
  return null;
}

/**
 * Botón que envía un formulario desde fuera de él (indicador de pasos, "Ver como el cliente").
 * Mientras el formulario se está guardando no envía otra vez.
 */
export function ExternalSubmit({ formId, value, className, children, noValidate }: { formId: string; value: string; className?: string; children: React.ReactNode; noValidate?: boolean }) {
  return (
    <button
      type="submit"
      form={formId}
      name="goTo"
      value={value}
      formNoValidate={noValidate}
      className={className}
      onClick={(e) => {
        if (document.getElementById(formId)?.getAttribute("aria-busy") === "true") e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

/** Botón de un formulario simple que se desactiva mientras se envía (evita crear dos veces). */
export function PendingButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={className}>
      {children}
    </button>
  );
}
