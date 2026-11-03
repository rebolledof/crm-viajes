import { Icon } from "@/components/icons";

/**
 * Código de formulario que no existe (AC-262, informe de pruebas del 3 nov 2026). La pinta page.tsx
 * directamente: con notFound() esta versión de Next manda un HTML vacío y el texto solo aparece con
 * JavaScript (prueba independiente del 3 nov 2026). No se sabe de qué
 * agencia es, así que no lleva marca de ninguna: explica qué pasó y qué puede hacer el cliente.
 */
export function FormNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas px-4 py-8">
      <div className="w-full max-w-xl rounded border border-line bg-surface px-5 py-8 text-center shadow-[0_2px_2px_rgba(0,0,0,0.05)]" role="status">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-800">
          <Icon name="form" className="size-6" />
        </span>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">No encontramos este formulario</h1>
        <p className="mt-2 text-sm text-slate-700">
          El enlace puede estar incompleto o haber cambiado. Revisa que lo copiaste completo, o escríbele a la agencia por su WhatsApp, su correo o su página web para pedir el enlace correcto.
        </p>
      </div>
    </div>
  );
}
