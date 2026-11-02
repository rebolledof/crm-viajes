"use client";

import { useField } from "@/components/form";

/**
 * "Recibir mensajes por el formulario": si el guardado falla por otro campo, conserva lo que la
 * persona marcó (prueba independiente, H-4). Una casilla sin marcar no viaja en el formulario, por
 * eso va con un campo oculto que indica que sí se envió.
 */
export function ActiveCheckbox({ saved }: { saved: boolean }) {
  const sent = useField("formActiveSent").sent;
  const f = useField("formActive");
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
      <input type="hidden" name="formActiveSent" value="1" />
      <input type="checkbox" name="formActive" defaultChecked={sent ? f.value === "on" : saved} className="size-4 accent-[var(--brand)]" />
      Recibir mensajes por el formulario
    </label>
  );
}
