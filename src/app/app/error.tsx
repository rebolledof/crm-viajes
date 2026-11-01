"use client";

// Si una pantalla falla en el servidor, el menú sigue visible y la persona sabe qué hacer,
// en lugar de la página genérica en inglés de Next.js.
import Link from "next/link";
import { buttonClass, linkButtonClass } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
      <h1 className="text-xl font-semibold">No pudimos cargar esta pantalla</h1>
      <p className="text-sm">
        Hubo un problema en el servidor. Intenta de nuevo; si sigue pasando, avísale al administrador con este código:{" "}
        <code className="rounded bg-white px-1">{error.digest ?? "sin código"}</code>.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={reset} className={buttonClass}>Intentar de nuevo</button>
        <Link href="/app/contactos" className={linkButtonClass}>Ir a Contactos</Link>
      </div>
    </div>
  );
}
