// SPEC-003 parte 2 · Chat web: reglas puras (validación del primer mensaje y de los siguientes,
// aviso de fuera de horario, ritmo de consulta y código para pegar en la web).
import { parseWebForm, MAX_MESSAGE } from "./inbox";

export type ChatStartInput = { name: string; phone: string; email: string; message: string; privacy: boolean };
export type ChatStartData = { name: string; phone: string | null; email: string | null; message: string };
export type ChatError = { field: keyof ChatStartInput; message: string };

/** Primer mensaje del chat (RF-272, RF-276): nombre, teléfono o correo, mensaje y aviso. */
export function parseChatStart(input: ChatStartInput): { ok: true; data: ChatStartData } | { ok: false; error: ChatError } {
  const msg = parseChatMessage(input.message);
  // Mismas reglas de contacto que el formulario, para que un visitante no vea dos criterios.
  const form = parseWebForm({ name: input.name, phone: input.phone, email: input.email, destination: "", dates: "", travelers: "", message: "", privacy: true });
  if (!form.ok) {
    const f = form.error.field;
    return { ok: false, error: { field: f === "contacto" ? "phone" : (f as keyof ChatStartInput), message: form.error.message } };
  }
  if (!msg.ok) return { ok: false, error: { field: "message", message: msg.message } };
  if (!input.privacy) return { ok: false, error: { field: "privacy", message: "Para enviar, acepta el aviso de privacidad. Lo que escribiste se conserva." } };
  return { ok: true, data: { name: form.data.name, phone: form.data.phone, email: form.data.email, message: msg.text } };
}

/** Un mensaje del chat: de 1 a 4.000 letras. */
export function parseChatMessage(raw: string): { ok: true; text: string } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: false, message: "Escribe tu mensaje." };
  if (text.length > MAX_MESSAGE) return { ok: false, message: `El mensaje es muy largo (máximo ${MAX_MESSAGE.toLocaleString("es-CO")} letras). Divídelo en dos.` };
  return { ok: true, text };
}

/** Llave del visitante: 32 bytes aleatorios en base64url (43 caracteres). */
export function isChatToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * Aviso de fuera de horario (AC-281). nextOpen es la hora local de la agencia en que abre; now,
 * la hora local actual (ambas como fecha "de pared", sin zona). Null si la agencia está abierta.
 */
export function offHoursNotice(openNow: boolean, nextOpen: Date, now: Date): string | null {
  if (openNow) return null;
  const sameDay = nextOpen.getUTCFullYear() === now.getUTCFullYear() && nextOpen.getUTCMonth() === now.getUTCMonth() && nextOpen.getUTCDate() === now.getUTCDate();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const isTomorrow = nextOpen.getUTCFullYear() === tomorrow.getUTCFullYear() && nextOpen.getUTCMonth() === tomorrow.getUTCMonth() && nextOpen.getUTCDate() === tomorrow.getUTCDate();
  const day = sameDay ? "hoy" : isTomorrow ? "mañana" : `el ${DAYS[nextOpen.getUTCDay()]}`;
  // "a. m." ya termina en punto: no se agrega otro.
  return `Estamos fuera de horario. Te respondemos ${day} desde las ${clock(nextOpen)} Puedes dejarnos tu mensaje.`;
}

function clock(d: Date): string {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

/**
 * Cada cuánto pregunta la ventana por mensajes nuevos: 5 segundos mientras hay actividad y 30
 * tras 2 minutos sin ella; cerrada u oculta, no pregunta (null).
 */
export function pollDelay(visible: boolean, msSinceActivity: number): number | null {
  if (!visible) return null;
  return msSinceActivity > 2 * 60_000 ? 30_000 : 5_000;
}

/** Código para pegar en la web de la agencia: carga la burbuja. */
export function chatSnippet(scriptUrl: string): string {
  // La dirección va escapada: ni una comilla ni un "<" pueden salir del atributo.
  const attr = scriptUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<script src="${attr}" async></script>`;
}

/**
 * La burbuja que carga la web de la agencia (AC-288): un botón con el color de la agencia que abre
 * la ventana del chat en un marco del CRM. La web de la agencia no recibe ningún dato del visitante;
 * del marco solo escucha el aviso de cerrar, y solo si viene del CRM.
 */
export function bubbleScript(o: { origin: string; key: string; color: string; agencyName: string }): string {
  // JSON con "<" escapado: ningún texto de la agencia puede cerrar un <script> ni inyectar código.
  const j = (v: string) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `(function () {
  if (window.__crmChat) return;
  window.__crmChat = true;
  var origin = ${j(o.origin)}, src = origin + "/c/" + ${j(o.key)}, color = ${j(o.color)}, name = ${j(o.agencyName)};
  var btn = document.createElement("button"), frame = null, isOpen = false;
  btn.type = "button";
  btn.setAttribute("aria-label", "Abrir el chat con " + name);
  btn.setAttribute("aria-expanded", "false");
  btn.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;width:56px;height:56px;border-radius:9999px;border:0;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;background:" + color;
  btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  function place() {
    if (!frame) return;
    var small = window.innerWidth < 480;
    frame.style.cssText = "position:fixed;z-index:2147483647;border:0;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);" +
      (small ? "inset:0;width:100%;height:100%;border-radius:0" : "right:16px;bottom:84px;width:380px;height:min(600px,calc(100vh - 100px));border-radius:12px");
    frame.style.display = isOpen ? "block" : "none";
    btn.style.display = isOpen && small ? "none" : "flex";
  }
  // Avisa a la ventana si se ve o no, para que no pregunte por mensajes con la burbuja cerrada.
  function tell() {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(isOpen ? "crm-chat:shown" : "crm-chat:hidden", origin);
  }
  function open() {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = src;
      frame.title = "Chat con " + name;
      frame.addEventListener("load", tell);
      document.body.appendChild(frame);
    }
    isOpen = true;
    btn.setAttribute("aria-expanded", "true");
    place();
    tell();
    frame.focus();
  }
  function close() {
    isOpen = false;
    btn.setAttribute("aria-expanded", "false");
    place();
    tell();
    btn.focus();
  }
  btn.addEventListener("click", function () { isOpen ? close() : open(); });
  window.addEventListener("message", function (e) {
    if (e.origin === origin && e.data === "crm-chat:close") close();
  });
  // Escape también cierra cuando el foco está en la web de la agencia y no dentro del chat.
  document.addEventListener("keydown", function (e) {
    if (isOpen && e.key === "Escape") close();
  });
  window.addEventListener("resize", place);
  function mount() { document.body.appendChild(btn); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
`;
}
