"use client";

import { useActionState, useEffect } from "react";
import { Notice } from "@/components/ui";
import { openTaskAction, type OpenTaskState } from "./followup-actions";

/** Un clic: abre WhatsApp (pestaña nueva) o el programa de correo con el mensaje de la tarea. */
export function TaskOpenButton({ taskId, channel, back, blocked, compact, primary = true }: { taskId: string; channel: "whatsapp" | "correo"; back: string; blocked?: string | null; compact?: boolean; primary?: boolean }) {
  const [state, action, pending] = useActionState<OpenTaskState, FormData>(openTaskAction, {});
  useEffect(() => {
    if (!state.link) return;
    if (state.channel === "whatsapp") window.open(state.link, "_blank", "noopener,noreferrer");
    else window.location.href = state.link;
  }, [state.link, state.channel, state.at]);
  const label = compact ? (channel === "whatsapp" ? "WhatsApp" : "Escribir correo") : channel === "whatsapp" ? "Abrir WhatsApp con el mensaje" : "Abrir correo con el mensaje";
  const title = channel === "whatsapp" ? "Abre WhatsApp con el mensaje de la tarea" : "Abre el correo con el mensaje de la tarea";
  // La acción principal de la fila va rellena; el resto, con borde, para que no compitan.
  const tone = !primary
    ? "border border-line bg-surface text-slate-800 hover:bg-slate-50"
    : channel === "whatsapp"
      ? "bg-whatsapp text-white hover:bg-whatsapp-strong"
      : "bg-brand text-brand-contrast hover:bg-brand-strong";
  const hintId = `canal-${taskId}`;
  if (blocked) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" disabled aria-describedby={hintId} title={title} className="w-fit cursor-not-allowed rounded-md bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500">
          {label}
        </button>
        <p id={hintId} className="text-sm text-amber-800">{blocked}</p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="back" value={back} />
      <div className="flex flex-wrap items-center gap-3">
        <button title={title} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${tone}`} disabled={pending}>
          {pending ? "Abriendo…" : label}
        </button>
        {state.link && (
          <a href={state.link} target={state.channel === "whatsapp" ? "_blank" : undefined} rel="noopener noreferrer" className="text-sm text-sky-700 underline">
            Si no se abrió, toca aquí
          </a>
        )}
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </form>
  );
}
