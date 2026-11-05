"use client";

import { useField } from "@/components/form";

/**
 * "Recibir mensajes por el formulario" o "por el chat": si el guardado falla por otro campo,
 * conserva lo que la persona marcó (prueba independiente, H-4). Una casilla sin marcar no viaja en
 * el formulario, por eso va con un campo oculto que indica que sí se envió.
 */
export function ActiveCheckbox({ saved, name = "formActive", label = "Recibir mensajes por el formulario" }: { saved: boolean; name?: string; label?: string }) {
  const sent = useField(`${name}Sent`).sent;
  const f = useField(name);
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
      <input type="hidden" name={`${name}Sent`} value="1" />
      <input type="checkbox" name={name} defaultChecked={sent ? f.value === "on" : saved} className="size-4 accent-[var(--brand)]" />
      {label}
    </label>
  );
}
