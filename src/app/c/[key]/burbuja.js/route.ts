// Burbuja del chat para la web de la agencia (SPEC-003 parte 2, AC-288). Un código que no existe
// devuelve un script vacío para no romper la web donde se pegó.
import { getDb, withAnon } from "@/db/client";
import { DEFAULT_PRIMARY, normalizeHex } from "@/domain/branding";
import { bubbleScript } from "@/domain/chat";
import { chatInfo } from "@/server/public-chat";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const info = await withAnon(getDb(), (tx) => chatInfo(tx, key));
  const h = request.headers;
  const origin = h.get("host") ? `${h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")}://${h.get("host")}` : new URL(request.url).origin;
  const body = info
    ? bubbleScript({ origin, key, color: normalizeHex(info.primary) ?? DEFAULT_PRIMARY, agencyName: info.agencyName })
    : "/* Chat no encontrado: revisa el código en Configuración › Canales de entrada. */\n";
  return new Response(body, {
    status: info ? 200 : 404,
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" },
  });
}
