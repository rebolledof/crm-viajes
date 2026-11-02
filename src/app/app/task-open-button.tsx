"use client";

import { useActionState, useEffect } from "react";
import { Notice } from "@/components/ui";
import { openTaskAction, type OpenTaskState } from "./followup-actions";

/** Un clic: abre WhatsApp (pestaña nueva) o el programa de correo con el mensaje de la tarea. */
export function TaskOpenButton({ taskId, channel, back, blocked }: { taskId: string; channel: "whatsapp" | "correo"; back: string; blocked?: string | null }) {
  const [state, action, pending] = useActionState<OpenTaskState, FormData>(openTaskAction, {});
  useEffect(() => {
    if (!state.link) return;
    if (state.channel === "whatsapp") window.open(state.link, "_blank", "noopener,noreferrer");
    else window.location.href = state.link;
  }, [state.link, state.channel, state.at]);
  const label = channel === "whatsapp" ? "Abrir WhatsApp con el mensaje" : "Abrir correo con el mensaje";
  const hintId = `canal-${taskId}`;
  if (blocked) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" disabled aria-describedby={hintId} className="w-fit cursor-not-allowed rounded-md bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500">
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
        <button className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50" disabled={pending}>
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
