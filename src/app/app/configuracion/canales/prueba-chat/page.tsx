import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Notice, PageHeader, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { chatSnippet } from "@/domain/chat";
import { can } from "@/domain/permissions";
import { getInboxSettings } from "@/server/inbox";
import { requireActiveAgency } from "@/server/session";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Página de prueba del chat (D-17): una web de ejemplo con la burbuja de la agencia, dentro de un
 * marco para que la burbuja no quede en el resto del CRM. Solo para administradores con sesión.
 */
export default async function PruebaChatPage() {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "inbox.manage")) redirect("/app?error=permission_denied");
  const s = await withUser(getDb(), user, (tx) => getInboxSettings(tx, user.id, active.agencyId));
  if (!s.chat) redirect("/app/configuracion/canales");
  const h = await headers();
  const origin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "");
  const name = esc(active.agencyName);
  const doc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Web de ejemplo</title>
<style>body{margin:0;font-family:system-ui,sans-serif;color:#1e293b;background:#f8fafc}header{padding:16px 20px;background:#fff;border-bottom:1px solid #e2e8f0;font-weight:700}
.hero{padding:48px 20px;background:linear-gradient(135deg,#0f6e6e,#1e9e9e);color:#fff}.hero h1{margin:0 0 8px;font-size:28px}main{padding:20px;max-width:720px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:12px 0}.tag{display:inline-block;background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:9999px;font-size:12px}</style>
</head><body><header>${name} <span class="tag">Web de ejemplo</span></header>
<section class="hero"><h1>Viaja a San Andrés</h1><p>Planes todo incluido para la temporada de diciembre.</p></section>
<main><div class="card"><b>Paquete 5 días</b><p>Vuelo, hotel y traslados. Pregúntanos por el chat.</p></div>
<div class="card"><b>Paquete 7 días</b><p>Con tour a Johnny Cay y acuario.</p></div>
<p style="font-size:13px;color:#475569">Toca la burbuja de la esquina para escribirle a tu propia agencia como si fueras un cliente.</p></main>
${chatSnippet(`${origin}/c/${s.chat.publicKey}/burbuja.js`)}
</body></html>`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="message" eyebrow={<Link href="/app/configuracion/canales" className={linkButtonClass}>Canales de entrada</Link>} title="Probar el chat">
        <p className="text-sm text-slate-600">Así se verá el chat en la web de {active.agencyName}. Escribe como si fueras un cliente: el mensaje llega a tu Bandeja y lo que respondas aparece en la burbuja.</p>
      </PageHeader>
      {!s.chat.active && (
        <Notice>
          El chat está apagado: la burbuja avisa que no recibe mensajes. Para conversar con ella, enciéndelo en{" "}
          <Link href="/app/configuracion/canales" className="font-medium underline">Canales de entrada</Link>.
        </Notice>
      )}
      <iframe srcDoc={doc} title="Web de ejemplo con el chat" className="h-[640px] w-full rounded border border-line bg-white" />
    </div>
  );
}
