"use client";

// Error en la estructura base de la aplicación: reemplaza todo, por eso trae su html y estilos mínimos.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 16, margin: 0, background: "#f8fafc", color: "#0f172a" }}>
        <main>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Algo salió mal</h1>
          <p style={{ fontSize: 14, color: "#334155", maxWidth: 420 }}>No pudimos mostrar esta página. Inténtalo de nuevo en un momento; si sigue pasando, avísale a la agencia.</p>
          <button type="button" onClick={() => retry()} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 6, border: "1px solid #334155", background: "#fff", cursor: "pointer" }}>
            Intentar de nuevo
          </button>
        </main>
      </body>
    </html>
  );
}
