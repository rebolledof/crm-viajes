"use client";

// Error inesperado en cualquier pantalla (informe de pruebas del 4 nov 2026): en vez de la página
// técnica en inglés, un aviso en español que dice qué hacer. El detalle queda en el registro.
import { useEffect } from "react";
import { buttonClass } from "@/components/ui";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Algo salió mal</h1>
      <p className="mt-2 max-w-md text-sm text-slate-700">No pudimos mostrar esta página. Inténtalo de nuevo en un momento; si sigue pasando, avísale a la agencia.</p>
      <button type="button" onClick={() => retry()} className={`${buttonClass} mt-4`}>
        Intentar de nuevo
      </button>
    </main>
  );
}
