"use client";

import { useField } from "@/components/form";

/** Aceptación del aviso de privacidad: conserva la marca si el envío falla por otro campo. */
export function PrivacyCheckbox({ agencyName, privacyUrl }: { agencyName: string; privacyUrl: string | null }) {
  const f = useField("privacy");
  return (
    <label className={`flex items-start gap-2 text-sm ${f.invalid ? "text-red-800" : "text-slate-700"}`}>
      <input
        type="checkbox"
        name="privacy"
        required
        defaultChecked={f.value === "on"}
        aria-invalid={f.invalid || undefined}
        autoFocus={f.invalid}
        className={`mt-0.5 size-4 shrink-0 accent-[var(--brand)] ${f.invalid ? "outline-2 outline-red-600" : ""}`}
      />
      <span>
        Acepto el{" "}
        {privacyUrl ? (
          <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-text underline">aviso de privacidad</a>
        ) : (
          <span className="font-medium">aviso de privacidad (borrador de ejemplo)</span>
        )}{" "}
        de {agencyName} para que me contacten sobre esta consulta.
      </span>
    </label>
  );
}
