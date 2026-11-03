import Link from "next/link";

/** Página no encontrada en español para cualquier dirección que no exista (informe del 3 nov 2026). */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-center">
      <h1 className="text-lg font-semibold text-slate-900">No encontramos esta página</h1>
      <p className="mt-2 max-w-md text-sm text-slate-700">La dirección puede estar mal escrita o la página ya no existe.</p>
      <Link href="/app" className="mt-4 text-sm font-medium text-brand-text underline">Ir al inicio</Link>
    </div>
  );
}
