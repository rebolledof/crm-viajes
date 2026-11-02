"use client";

import { useActionState, useEffect } from "react";
import { Field, Notice, buttonClass, inputClass } from "@/components/ui";
import { openWhatsappAction, type WhatsappState } from "../crm-actions";

/** Registra la apertura en el historial y abre WhatsApp con el mensaje editable (RF-212). */
export function WhatsappButton({ contactId, opportunityId, draft }: { contactId: string; opportunityId?: string; draft: string }) {
  const [state, action, pending] = useActionState<WhatsappState, FormData>(openWhatsappAction, {});
  useEffect(() => {
    if (state.link) window.open(state.link, "_blank", "noopener,noreferrer");
  }, [state.link, state.at]);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="contactId" value={contactId} />
      {opportunityId && <input type="hidden" name="opportunityId" value={opportunityId} />}
      <Field label="Mensaje">
        <textarea name="message" defaultValue={draft} rows={2} maxLength={1000} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button className={buttonClass} disabled={pending}>{pending ? "Abriendo…" : "Abrir WhatsApp"}</button>
        {state.link && (
          <a href={state.link} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-700 underline">
            Si no se abrió, toca aquí
          </a>
        )}
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </form>
  );
}
