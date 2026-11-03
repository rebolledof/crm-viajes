import type { Metadata } from "next";
import { cache } from "react";
import { getDb, withAnon } from "@/db/client";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, agencyInitials, brandCssVars, cssBlock, normalizeHex } from "@/domain/branding";
import { offHoursNotice } from "@/domain/chat";
import { chatInfo } from "@/server/public-chat";
import { ChatWindow } from "./chat-window";

// Una sola consulta por petición aunque la usen generateMetadata y la página.
const info = cache((key: string) => withAnon(getDb(), (tx) => chatInfo(tx, key)));

type Props = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  const i = await info(key);
  return { title: i ? `Chat con ${i.agencyName}` : "Chat no encontrado", robots: { index: false, follow: false } };
}

/**
 * Ventana del chat web (SPEC-003 parte 2). La abre la burbuja dentro de un marco en la web de la
 * agencia; también funciona sola. Lleva el nombre, logo y colores de la agencia.
 */
export default async function ChatPage({ params }: Props) {
  const { key } = await params;
  const i = await info(key);
  if (!i) {
    // Se pinta aquí y no con notFound(): esta versión de Next manda un HTML vacío sin JavaScript.
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-6 text-center">
        <div>
          <h1 className="font-semibold text-slate-900">No encontramos este chat</h1>
          <p className="mt-2 text-sm text-slate-700">El código del chat puede estar incompleto. Escríbele a la agencia por su WhatsApp o su correo.</p>
        </div>
      </main>
    );
  }
  const vars = brandCssVars({ primary: normalizeHex(i.primary) ?? DEFAULT_PRIMARY, accent: normalizeHex(i.accent) ?? DEFAULT_ACCENT });
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cssBlock(":root", vars.light) }} />
      <ChatWindow
        chatKey={key}
        agencyName={i.agencyName}
        initials={agencyInitials(i.agencyName)}
        logoUrl={i.hasLogo ? `/f/${key}/logo?v=${i.logoVersion}` : null}
        privacyUrl={i.privacyUrl}
        active={i.active}
        offHours={offHoursNotice(i.openNow, i.nextOpen, i.localNow)}
      />
    </>
  );
}
