import { getDb, withAnon } from "@/db/client";
import { webFormLogo } from "@/server/public-form";

/** Logo de la agencia para su formulario público (SPEC-003). Solo con un código de formulario válido. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const logo = await withAnon(getDb(), (tx) => webFormLogo(tx, key));
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
