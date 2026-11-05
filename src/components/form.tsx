"use client";

// Formularios que conservan lo escrito cuando el servidor rechaza los datos y resaltan el campo
// con el problema. La acción devuelve un FormState en el error y redirige cuando todo sale bien.
import Link from "next/link";
import { createContext, useActionState, useContext, type ReactNode } from "react";
import { Notice, inputClass } from "./ui";

export type FormState = {
  error?: string;
  /** Campo con el problema: "fullName" o, si hay varios con el mismo nombre, "phone.1". */
  field?: string;
  /** Lo que la persona había escrito, por nombre de campo. */
  values?: Record<string, string[]>;
  link?: { href: string; label: string };
  /** Ruta a la que ir cuando todo salió bien, si la acción no redirige ella misma (formulario de marca). */
  redirectTo?: string;
  at?: number;
};

export type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>;

const Ctx = createContext<FormState>({});

export function ActionForm({ action, className, children, id }: { action: FormAction; className?: string; children: ReactNode; id?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <Ctx.Provider value={state}>
      {/* La clave nueva vuelve a montar los campos con los valores que devolvió el servidor. */}
      <form key={state.at ?? 0} id={id} action={formAction} className={className} aria-busy={pending}>
        {state.error && (
          <div className="col-span-full">
            <Notice tone="error">
              {state.error}
              {state.link && (
                <>
                  {" "}
                  <Link href={state.link.href} className="font-medium underline">{state.link.label}</Link>
                </>
              )}
            </Notice>
          </div>
        )}
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
      </form>
    </Ctx.Provider>
  );
}

const invalidClass = "border-red-500 bg-red-50 focus:outline-red-600";

/** Valor inicial del campo y si es el que tiene el problema. */
export function useField(name: string, index = 0, fallback?: string | number | null) {
  const state = useContext(Ctx);
  const sent = state.values?.[name];
  const value = sent ? (sent[index] ?? "") : fallback == null ? "" : String(fallback);
  const invalid = state.field === name || state.field === `${name}.${index}`;
  return { value, invalid, sent: sent !== undefined };
}

type Common = { name: string; index?: number; defaultValue?: string | number | null; className?: string };

export function Input({ name, index = 0, defaultValue, className, ...rest }: Common & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "defaultValue" | "className">) {
  const f = useField(name, index, defaultValue);
  return (
    <input
      {...rest}
      name={name}
      defaultValue={"value" in rest ? undefined : f.value}
      aria-invalid={f.invalid || undefined}
      autoFocus={f.invalid || rest.autoFocus}
      className={`${inputClass} ${f.invalid ? invalidClass : ""} ${className ?? ""}`}
    />
  );
}

export function Textarea({ name, defaultValue, className, ...rest }: Common & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "defaultValue" | "className">) {
  const f = useField(name, 0, defaultValue);
  return (
    <textarea
      {...rest}
      name={name}
      defaultValue={"value" in rest ? undefined : f.value}
      aria-invalid={f.invalid || undefined}
      autoFocus={f.invalid}
      className={`${inputClass} ${f.invalid ? invalidClass : ""} ${className ?? ""}`}
    />
  );
}

export function Select({ name, defaultValue, className, children, ...rest }: Common & { children: ReactNode } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name" | "defaultValue" | "className">) {
  const f = useField(name, 0, defaultValue);
  return (
    <select
      {...rest}
      name={name}
      defaultValue={"value" in rest ? undefined : f.value}
      aria-invalid={f.invalid || undefined}
      autoFocus={f.invalid}
      className={`${inputClass} ${f.invalid ? invalidClass : ""} ${className ?? ""}`}
    >
      {children}
    </select>
  );
}

/** Estado del último envío (para listas que crecen en el navegador, como los servicios). */
export function useFormState(): FormState {
  return useContext(Ctx);
}

/** Casilla que conserva lo marcado cuando el servidor rechaza el formulario. */
export function Checkbox({ name, defaultChecked, label, className }: { name: string; defaultChecked?: boolean; label: ReactNode; className?: string }) {
  const state = useContext(Ctx);
  const checked = state.values ? (state.values[name]?.[0] ?? "") === "on" : !!defaultChecked;
  return (
    <label className={`flex items-start gap-2 text-sm text-slate-800 ${className ?? ""}`}>
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 size-4 accent-[var(--brand)]" />
      <span>{label}</span>
    </label>
  );
}
