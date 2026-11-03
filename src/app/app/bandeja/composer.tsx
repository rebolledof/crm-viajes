"use client";

// Caja de respuesta de la bandeja (SPEC-003, alcance 9 y 11): escribir "/" muestra las respuestas
// guardadas; al elegir una se reemplazan {nombre}, {asesor} y {agencia} y se puede editar antes de
// enviar. Enviar registra la respuesta y abre WhatsApp o el correo con el texto.
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/ui";
import { fillSavedReply, matchReplies, typedShortcut } from "@/domain/inbox";
import { replyAction, type ReplyState } from "../inbox-actions";

export type ComposerReply = { id: string; title: string; shortcut: string; body: string; personal: boolean };

type Channel = { via: "whatsapp" | "correo"; label: string; blocked: string | null };

export function Composer({
  conversationId,
  filter,
  replies,
  values,
  channels,
  hint,
}: {
  conversationId: string;
  filter: string;
  replies: ComposerReply[];
  values: { nombre: string; asesor: string; agencia: string };
  channels: Channel[];
  hint: string;
}) {
  const [state, action, pending] = useActionState<ReplyState, FormData>(replyAction, {});
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  // Tras cada envío: si salió bien, la caja queda vacía; si falló, conserva lo escrito.
  const [handled, setHandled] = useState<number | undefined>(undefined);
  if (state.at !== handled) {
    setHandled(state.at);
    if (state.link) setText("");
    else if (state.error && state.body !== undefined) setText(state.body);
  }
  // Abre WhatsApp en otra pestaña o el programa de correo con el texto.
  useEffect(() => {
    if (!state.link) return;
    if (state.via === "whatsapp") window.open(state.link, "_blank", "noopener,noreferrer");
    else window.location.href = state.link;
  }, [state.link, state.via, state.at]);

  const query = typedShortcut(text);
  const options = useMemo(() => (query !== null ? matchReplies(replies, query) : showAll ? replies : []), [query, replies, showAll]);
  const open = options.length > 0;

  function insert(r: ComposerReply) {
    setText(fillSavedReply(r.body, values));
    setShowAll(false);
    setActive(0);
    requestAnimationFrame(() => box.current?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(options[Math.min(active, options.length - 1)]);
    } else if (e.key === "Escape") {
      setShowAll(false);
      setText((t) => (typedShortcut(t) !== null ? "" : t));
    }
  }

  const usable = channels.filter((c) => !c.blocked);
  const listId = `respuestas-${conversationId}`;

  return (
    <form action={action} className="relative flex flex-col gap-2 border-t border-slate-100 p-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="f" value={filter} />
      {open && (
        <div id={listId} role="listbox" aria-label="Respuestas guardadas" className="absolute right-3 bottom-full left-3 z-10 mb-1 max-h-72 overflow-y-auto rounded border border-line bg-surface shadow-lg">
          <p className="px-3 py-1.5 text-xs text-slate-600">Respuestas guardadas · flechas para elegir, Enter para insertar</p>
          {options.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(r)}
              className={`flex w-full flex-col gap-0.5 border-t border-slate-100 px-3 py-2 text-left text-sm ${i === active ? "bg-brand-softer" : "hover:bg-slate-50"}`}
            >
              <span className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{r.title}</span>
                <code className="rounded bg-slate-100 px-1.5 text-xs text-slate-700">/{r.shortcut}</code>
                {r.personal && <span className="text-xs text-slate-600">personal</span>}
              </span>
              <span className="line-clamp-2 text-xs text-slate-600">{r.body}</span>
            </button>
          ))}
        </div>
      )}
      <label htmlFor={`caja-${conversationId}`} className="sr-only">Tu respuesta</label>
      <textarea
        ref={box}
        id={`caja-${conversationId}`}
        name="body"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        rows={4}
        maxLength={4000}
        required
        aria-invalid={state.error && state.field === "body" ? true : undefined}
        aria-controls={open ? listId : undefined}
        placeholder="Escribe tu respuesta o / para usar una respuesta guardada"
        className={`rounded border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-2 focus:outline-brand ${state.error && state.field === "body" ? "border-red-500 bg-red-50" : "border-slate-300 bg-surface"}`}
      />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.link && (
        <Notice tone="ok">
          Respuesta registrada.{" "}
          <a href={state.link} target={state.via === "whatsapp" ? "_blank" : undefined} rel="noopener noreferrer" className="font-medium underline">
            Si no se abrió {state.via === "whatsapp" ? "WhatsApp" : "el correo"}, toca aquí
          </a>
          .
        </Notice>
      )}
      <p className="text-xs text-slate-600">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-brand-text hover:bg-slate-50"
        >
          <Icon name="zap" className="size-4" /> Respuestas guardadas
        </button>
        <span className="flex-1" />
        {usable.map((c, i) => (
          <button
            key={c.via}
            name="via"
            value={c.via}
            disabled={pending}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              i === 0
                ? c.via === "whatsapp"
                  ? "bg-whatsapp text-white hover:bg-whatsapp-strong"
                  : "bg-brand text-brand-contrast hover:bg-brand-strong"
                : "border border-slate-300 bg-surface text-slate-800 hover:bg-slate-50"
            }`}
          >
            <Icon name={c.via === "whatsapp" ? "message" : "mail"} className="size-4" />
            {pending ? "Registrando…" : c.label}
          </button>
        ))}
      </div>
      {/* Lo que no se puede usar se explica en vez de mostrar un botón apagado. */}
      {channels.some((c) => c.blocked) && (
        <p className={`text-xs ${usable.length === 0 ? "text-amber-800" : "text-slate-600"}`}>
          {channels
            .filter((c) => c.blocked)
            .map((c) => `${c.via === "whatsapp" ? "WhatsApp" : "Correo"}: ${c.blocked}`)
            .join(" ")}
          {usable.length === 0 && " Agrega un teléfono o correo en la ficha del contacto para poder responder."}
        </p>
      )}
    </form>
  );
}
