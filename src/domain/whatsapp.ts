/** Botón de WhatsApp (SPEC-002 RF-212). Solo abre la app; quien envía es el asesor. */
export const DEFAULT_WHATSAPP_TEMPLATE = "Hola {nombre}, te escribo de {agencia} por tu viaje a {destino}.";

export function fillWhatsappTemplate(
  template: string,
  values: { nombre: string; agencia: string; destino?: string | null },
): string {
  const firstName = values.nombre.trim().split(/\s+/)[0] ?? "";
  let text = template
    .replaceAll("{nombre}", firstName)
    .replaceAll("{agencia}", values.agencia.trim());
  text = values.destino?.trim()
    ? text.replaceAll("{destino}", values.destino.trim())
    : text.replace(/ por tu viaje a \{destino\}/g, "").replaceAll("{destino}", "");
  return text.replace(/\s+([.,])/g, "$1").trim();
}

/** Enlace oficial de clic para chatear: https://wa.me/<número sin +>?text=<mensaje>. */
export function whatsappLink(e164: string, message: string): string {
  const digits = e164.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export type ConsentRecord = { channel: string; purpose: string; status: "otorgado" | "retirado" };

/**
 * El último registro de cada canal y finalidad manda. Si retiró WhatsApp para servicio, no se ofrece
 * el botón. "Sin registrar" sí lo permite: es respuesta a una consulta del propio cliente.
 */
export function whatsappAllowed(latest: ConsentRecord[]): boolean {
  return !latest.some((c) => c.channel === "whatsapp" && c.purpose === "servicio" && c.status === "retirado");
}
