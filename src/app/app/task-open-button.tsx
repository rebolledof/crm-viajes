"use client";

import { useActionState, useEffect } from "react";
import { Notice } from "@/components/ui";
import { openTaskAction, type OpenTaskState } from "./followup-actions";

/** Un clic: abre WhatsApp (pestaña nueva) o el programa de correo con el mensaje de la tarea. */
export function TaskOpenButton({ taskId, channel, back }: { taskId: string; channel: "whatsapp" | "correo"; back: string }) {
  const [state, action, pending] = useActionState<OpenTaskState, FormData>(openTaskAction, {});
  useEffect(() => {
    if (!state.link) return;
    if (state.channel === "whatsapp") window.open(state.link, "_blank", "noopener,noreferrer");
    else window.location.href = state.link;
  }, [state.link, state.channel, state.at]);
  const label = channel === "whatsapp" ? "Abrir WhatsApp con el mensaje" : "Abrir correo con el mensaje";
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
