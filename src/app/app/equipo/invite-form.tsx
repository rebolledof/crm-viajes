"use client";

import { useActionState, useState } from "react";
import { Field, Notice, buttonClass, inputClass } from "@/components/ui";
import { ROLES, ROLE_LABELS } from "@/domain/permissions";
import { inviteAction, type InviteState } from "../actions";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <Field label="Correo">
          <input id="invite-email" name="email" type="email" required className={inputClass} />
        </Field>
        <Field label="Rol">
          <select id="invite-role" name="role" defaultValue="asesor" className={inputClass}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>
        <button className={buttonClass} disabled={pending}>{pending ? "Creando…" : "Crear invitación"}</button>
      </form>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.link && (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>
            Invitación creada para <strong>{state.email}</strong>. Envíale este enlace; vence en 7 días y solo se muestra ahora.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs text-slate-800">{state.link}</code>
            <button
              type="button"
              className="text-sky-700 hover:underline"
              onClick={() => navigator.clipboard.writeText(state.link!).then(() => setCopied(true), () => setCopied(false))}
            >
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
