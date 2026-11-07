import { getDb, withUser } from "@/db/client";
import { AppError } from "@/server/errors";
import { getQuotePdf } from "@/server/quotes";
import { getAppContext } from "@/server/session";

/**
 * "Descargar PDF" de una versión (SPEC-004 alcance 15). La agencia sale de la sesión y la lectura
 * pasa por RLS; una versión de otra agencia responde 404 sin revelar que existe (AC-411).
 * ?ver=1 lo abre en el navegador en vez de descargarlo.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, active } = await getAppContext();
  if (!active) return new Response("No encontramos esta cotización.", { status: 404 });
  const { id } = await params;
  try {
    const pdf = await withUser(getDb(), user, (tx) => getQuotePdf(tx, user.id, active.agencyId, id, new Date()));
    const inline = new URL(req.url).searchParams.get("ver") === "1";
    return new Response(new Uint8Array(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${pdf.filename}"`,
        // Un borrador cambia; una versión enviada nunca.
        "Cache-Control": pdf.draft ? "private, no-store" : "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AppError && (err.code === "not_found" || err.code === "permission_denied")) {
      return new Response("No encontramos esta cotización.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw err;
  }
}
