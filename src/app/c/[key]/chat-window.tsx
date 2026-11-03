"use client";

// Ventana del chat web (SPEC-003 parte 2). Antes del primer mensaje pide nombre, teléfono o correo
// y el aviso de privacidad; después muestra la conversación y pregunta por respuestas nuevas cada
// pocos segundos mientras está visible. La llave del visitante queda en este navegador.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActionForm, Input, Textarea } from "@/components/form";
import { Icon } from "@/components/icons";
import { Field, Notice, buttonClass } from "@/components/ui";
import { pollDelay } from "@/domain/chat";
import type { ChatMessage } from "@/server/public-chat";
import { PrivacyCheckbox } from "../../f/[key]/privacy-checkbox";
import { loadChatAction, sendChatAction, startChatAction, type ChatStartState } from "./actions";

const hora = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });

function storageKey(chatKey: string) {
  return `crm-chat:${chatKey}`;
}
function readToken(chatKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(chatKey));
  } catch {
    return null;
  }
}
function writeToken(chatKey: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(storageKey(chatKey), token);
    else window.localStorage.removeItem(storageKey(chatKey));
  } catch {
    // Sin almacenamiento (navegación privada): la conversación dura mientras la ventana siga abierta.
  }
}

const noSubscribe = () => () => {};

const EXPIRED_NOTICE = "Tu conversación anterior ya no está disponible. Escríbenos de nuevo y un asesor te responde aquí.";
const EXPIRED_DRAFT_NOTICE = "Tu conversación anterior ya no está disponible, así que empezamos una nueva. Tu mensaje sigue abajo: completa tus datos y pulsa Enviar.";

/** Pide a la web de la agencia que cierre la burbuja (si estamos dentro de su marco). */
function closeBubble() {
  if (window.parent !== window) window.parent.postMessage("crm-chat:close", "*");
}

export function ChatWindow({
  chatKey,
  agencyName,
  initials,
  logoUrl,
  privacyUrl,
  active,
  offHours,
}: {
  chatKey: string;
  agencyName: string;
  initials: string;
  logoUrl: string | null;
  privacyUrl: string | null;
  active: boolean;
  offHours: string | null;
}) {
  // En el servidor no hay navegador: hasta hidratar, la ventana dice "Cargando…".
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  // undefined = usar la llave guardada en el navegador; null = sin conversación.
  const [tokenState, setToken] = useState<string | null | undefined>(undefined);
  const token = tokenState !== undefined ? tokenState : hydrated ? readToken(chatKey) : undefined;
  const framed = hydrated && window.parent !== window;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Si la conversación venció: aviso en el formulario y el texto que el visitante alcanzó a escribir.
  const [restart, setRestart] = useState<{ notice: string; draft: string } | null>(null);
  const [received, setReceived] = useState(false);
  const lastActivity = useRef(0);
  // La burbuja avisa si está cerrada: entonces no se pregunta por mensajes nuevos.
  const bubbleHidden = useRef(false);

  useEffect(() => {
    lastActivity.current = Date.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeBubble();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatKey]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const list = await loadChatAction(chatKey, token);
    if (list.length === 0) {
      // Llave vencida o inválida (AC-280): se empieza de cero, diciendo por qué.
      writeToken(chatKey, null);
      setToken(null);
      setMessages([]);
      setRestart((r) => r ?? { notice: EXPIRED_NOTICE, draft: "" });
      return;
    }
    setMessages((prev) => (prev.length === list.length && prev.at(-1)?.id === list.at(-1)?.id ? prev : list));
  }, [chatKey, token]);

  // Primera carga y consulta periódica mientras la ventana está visible (RF-274).
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      await refresh().catch(() => {});
      if (stopped) return;
      const visible = document.visibilityState === "visible" && !bubbleHidden.current;
      const delay = pollDelay(visible, Date.now() - lastActivity.current);
      if (delay !== null) timer = setTimeout(tick, delay);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        tick();
      }
    };
    const onBubble = (e: MessageEvent) => {
      if (e.source !== window.parent || window.parent === window) return;
      if (e.data === "crm-chat:hidden") {
        bubbleHidden.current = true;
        clearTimeout(timer);
      } else if (e.data === "crm-chat:shown" && bubbleHidden.current) {
        bubbleHidden.current = false;
        clearTimeout(timer);
        tick();
      }
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("message", onBubble);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("message", onBubble);
    };
  }, [token, refresh]);

  async function onStart(prev: ChatStartState, fd: FormData): Promise<ChatStartState> {
    const r = await startChatAction(prev, fd);
    if (r.received) setReceived(true);
    if (r.token) {
      lastActivity.current = Date.now();
      writeToken(chatKey, r.token);
      setNotice("Recibimos tu mensaje. Un asesor te responderá pronto aquí mismo.");
      setRestart(null);
      setToken(r.token);
    }
    return r;
  }

  return (
    <main className="flex h-dvh flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b-[3px] border-brand bg-surface px-4 py-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo servido por la app
          <img src={logoUrl} alt="" className="size-9 rounded object-contain" />
        ) : (
          <span aria-hidden className="flex size-9 items-center justify-center rounded bg-brand text-sm font-bold text-brand-contrast">{initials}</span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold text-slate-900">{agencyName}</h1>
          <p className="text-xs text-slate-600">Chatea con un asesor</p>
        </div>
        {framed && (
          <button type="button" onClick={closeBubble} aria-label="Cerrar el chat" className="rounded p-2 text-slate-700 hover:bg-slate-100">
            <Icon name="down" className="size-5" />
          </button>
        )}
      </header>

      {offHours && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="status">{offHours}</p>}

      {token === undefined ? (
        <p className="p-4 text-sm text-slate-600">Cargando…</p>
      ) : !token ? (
        <div className="flex-1 overflow-y-auto p-4">
          {received ? (
            <Notice tone="ok">Recibimos tu mensaje. Un asesor te responderá pronto.</Notice>
          ) : !active ? (
            <Notice>Este chat no está recibiendo mensajes ahora. Escríbele a {agencyName} por WhatsApp o por correo.</Notice>
          ) : (
            <ActionForm action={onStart} className="flex flex-col gap-3">
              {restart && <Notice>{restart.notice}</Notice>}
              <input type="hidden" name="key" value={chatKey} />
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  No llenar este campo
                  <input name="hp_contacto" tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" />
                </label>
              </div>
              <p className="text-sm text-slate-700">Hola 👋 Escríbenos y te respondemos aquí. Déjanos un teléfono o un correo por si se corta la conversación. Los campos con * son obligatorios.</p>
              <Field label="Nombre">
                <Input name="name" required maxLength={160} autoComplete="name" />
              </Field>
              <Field label="Teléfono (WhatsApp)">
                <Input name="phone" type="tel" maxLength={30} autoComplete="tel" placeholder="300 000 0000" />
              </Field>
              <Field label="Correo">
                <Input name="email" type="email" maxLength={254} autoComplete="email" placeholder="nombre@correo.com" />
              </Field>
              <Field label="Mensaje">
                <Textarea name="message" required rows={3} maxLength={4000} placeholder="¿En qué te ayudamos?" defaultValue={restart?.draft || undefined} />
              </Field>
              <PrivacyCheckbox agencyName={agencyName} privacyUrl={privacyUrl} />
              <button className={buttonClass}>
                <Icon name="send" className="size-4" /> Enviar
              </button>
            </ActionForm>
          )}
        </div>
      ) : (
        <Conversation
          chatKey={chatKey}
          token={token}
          messages={messages}
          notice={notice}
          active={active}
          onSent={async () => {
            lastActivity.current = Date.now();
            setNotice(null);
            await refresh();
          }}
          onExpired={(draft) => {
            writeToken(chatKey, null);
            setMessages([]);
            setRestart({ notice: draft ? EXPIRED_DRAFT_NOTICE : EXPIRED_NOTICE, draft });
            setToken(null);
          }}
        />
      )}
    </main>
  );
}

function Conversation({
  chatKey,
  token,
  messages,
  notice,
  active,
  onSent,
  onExpired,
}: {
  chatKey: string;
  token: string;
  messages: ChatMessage[];
  notice: string | null;
  active: boolean;
  onSent: () => Promise<void>;
  onExpired: (draft: string) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const end = useRef<HTMLLIElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const r = await sendChatAction(chatKey, token, text).catch(() => ({ ok: false as const, error: "No pudimos enviar tu mensaje. Revisa tu conexión e inténtalo de nuevo; lo que escribiste se conserva." }));
    setPending(false);
    if (r.ok) {
      setText("");
      await onSent();
    } else {
      // Lo escrito se conserva (regla de usabilidad).
      setError(r.error);
      if ("expired" in r && r.expired) onExpired(text);
    }
  }

  return (
    <>
      <ol className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" aria-label="Mensajes" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.direction === "entrante" ? "self-end bg-brand-soft" : "self-start border border-slate-200 bg-surface"}`}>
            <p className="whitespace-pre-wrap text-slate-900">{m.body}</p>
            <p className="mt-1 text-xs text-slate-600">
              {m.direction === "entrante" ? "Tú" : m.authorName} · {hora.format(new Date(m.createdAt))}
            </p>
          </li>
        ))}
        {/* El aviso de "recibimos tu mensaje" sobra cuando ya respondió un asesor. */}
        {notice && !messages.some((m) => m.direction === "saliente") && (
          <li className="self-center rounded-full bg-slate-100 px-3 py-1 text-center text-xs text-slate-700" role="status">
            {notice}
          </li>
        )}
        <li ref={end} aria-hidden />
      </ol>
      <form onSubmit={send} className="flex flex-col gap-2 border-t border-slate-200 bg-surface p-3">
        {error && <Notice tone="error">{error}</Notice>}
        {!active && !error && <Notice>Este chat no está recibiendo mensajes ahora. Escríbele a la agencia por WhatsApp o por correo.</Notice>}
        <label htmlFor="chat-mensaje" className="sr-only">Tu mensaje</label>
        <div className="flex items-end gap-2">
          <textarea
            id="chat-mensaje"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Durante la composición (acentos, teclados asiáticos) Enter confirma la letra, no envía.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            maxLength={4000}
            required
            aria-invalid={error ? true : undefined}
            placeholder="Escribe tu mensaje"
            className={`min-w-0 flex-1 resize-none rounded border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-2 focus:outline-brand ${error ? "border-red-500 bg-red-50" : "border-slate-300 bg-surface"}`}
          />
          <button disabled={pending} className={`${buttonClass} disabled:opacity-50`} aria-label="Enviar mensaje">
            <Icon name="send" className="size-4" />
            <span className="sr-only sm:not-sr-only">{pending ? "Enviando…" : "Enviar"}</span>
          </button>
        </div>
        <p className="text-xs text-slate-600">Enter envía; Mayúsculas + Enter hace un salto de línea.</p>
      </form>
    </>
  );
}
