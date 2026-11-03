import { getDb, withUser } from "@/db/client";
import { getLogo } from "@/server/branding";
import { getAppContext } from "@/server/session";

/**
 * Logo de la agencia activa (SPEC-002c). Se lee con la sesión y RLS, igual que el resto de datos;
 * el tipo ya se verificó por sus bytes al subirlo. La URL lleva ?v= para poder guardarlo en caché.
 */
export async function GET() {
  const { user, active } = await getAppContext();
  if (!active) return new Response(null, { status: 404 });
  const logo = await withUser(getDb(), user, (tx) => getLogo(tx, user.id, active.agencyId));
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
