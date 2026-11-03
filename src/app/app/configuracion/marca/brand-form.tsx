"use client";

// Formulario de la marca con vista previa en vivo (RF-241 y RF-242). La vista previa solo pinta;
// el servidor vuelve a validar colores y logo y la base solo deja guardar a un administrador.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionForm, useField, type FormState } from "@/components/form";
import { Icon } from "@/components/icons";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, LOGO_MAX_BYTES, brandCssVars, checkLogoFile, contrastWarning, cssBlock, normalizeHex } from "@/domain/branding";
import { updateBrandingAction } from "../../branding-actions";

type Props = { primary: string; accent: string; logoUrl: string | null; initials: string; agencyName: string };

const LOGO_MESSAGES = {
  logo_too_big: "El logo pesa más de 512 KB. Redúcelo o expórtalo como WebP y vuelve a elegirlo.",
  logo_type: "Ese archivo no es una imagen PNG, WebP o JPG (aunque su nombre lo diga). Elige otro.",
  envio: "No se pudo subir el logo. Revisa que sea PNG, WebP o JPG de hasta 512 KB y vuelve a intentarlo.",
};
const SAVE_FAILED =
  "No se pudo guardar la marca y los colores siguen escritos. Revisa tu conexión; si llevas rato sin usar el CRM, tu sesión pudo cerrarse: entra de nuevo en otra pestaña y vuelve a pulsar Guardar.";

/** Lo escrito en el formulario, para devolverlo si se rechaza (sin el archivo). */
function keep(fd: FormData): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) if (!k.startsWith("$") && typeof v === "string") (values[k] ??= []).push(v);
  return values;
}

export function BrandForm(props: Props) {
  const router = useRouter();
  // Revisa el logo antes de enviarlo y convierte cualquier falla del envío (archivo demasiado grande
  // para la plataforma, conexión) en un aviso sobre el campo, sin perder los colores (AC-242).
  async function save(prev: FormState, fd: FormData): Promise<FormState> {
    const fail = (code: keyof typeof LOGO_MESSAGES): FormState => ({ error: LOGO_MESSAGES[code], field: "logo", values: keep(fd), at: Date.now() });
    const file = fd.get("logo");
    if (file instanceof File && file.size > 0 && fd.get("removeLogo") !== "1") {
      const problem = checkLogoFile({ size: file.size, head: new Uint8Array(await file.slice(0, 16).arrayBuffer()) });
      if (problem) return fail(problem);
    }
    const sendsLogo = file instanceof File && file.size > 0;
    let state: FormState;
    try {
      state = await updateBrandingAction(prev, fd);
    } catch {
      return sendsLogo ? fail("envio") : { error: SAVE_FAILED, values: keep(fd), at: Date.now() };
    }
    if (state.redirectTo) {
      router.replace(state.redirectTo);
      router.refresh();
    }
    return state;
  }
  return (
    <ActionForm action={save} className="flex flex-col gap-4">
      <BrandFields {...props} />
    </ActionForm>
  );
}

function useColorField({ name, label, help, fallback }: { name: string; label: string; help: string; fallback: string }) {
  const f = useField(name, 0, fallback);
  const [value, setValue] = useState(f.value);
  const hex = normalizeHex(value);
  return { value, setValue, hex, el: (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`${name}-hex`} className="font-medium text-slate-700 after:ml-0.5 after:text-red-700 after:content-['*']">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: elegir en la paleta`}
          value={hex ?? fallback}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded border border-slate-300 bg-surface p-1"
        />
        <input
          id={`${name}-hex`}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          pattern="#?[0-9A-Fa-f]{6}"
          maxLength={7}
          aria-invalid={f.invalid || !hex || undefined}
          aria-describedby={`${name}-help`}
          className={`${inputClass} w-32 font-mono uppercase ${f.invalid || !hex ? "border-red-500 bg-red-50" : ""}`}
        />
      </div>
      <p id={`${name}-help`} className={`text-xs ${hex ? "text-slate-600" : "text-red-700"}`}>{hex ? help : "Escribe el color en formato #RRGGBB, por ejemplo #0F6E6E."}</p>
    </div>
  ) };
}

function BrandFields({ primary, accent, logoUrl, initials, agencyName }: Props) {
  const p = useColorField({ name: "primary", label: "Color principal", help: "Menú, botones y enlaces.", fallback: primary });
  const a = useColorField({ name: "accent", label: "Color de acento", help: "Pestaña activa, avisos y botones de «Definir paso».", fallback: accent });
  const logoField = useField("logo");
  const [file, setFile] = useState<{ url: string; error?: string } | null>(null);
  const [remove, setRemove] = useState(false);
  useEffect(() => () => { if (file?.url) URL.revokeObjectURL(file.url); }, [file]);

  // Los colores ya pasaron por normalizeHex: el bloque CSS solo lleva "#RRGGBB".
  const vars = brandCssVars({ primary: p.hex ?? primary, accent: a.hex ?? accent });
  const previewCss = [
    cssBlock(".brand-preview", vars.light),
    cssBlock(".dark .brand-preview", vars.dark),
    `@media (prefers-color-scheme: dark){${cssBlock(".theme-system .brand-preview", vars.dark)}}`,
  ].join("");
  const warn = p.hex ? contrastWarning(p.hex) : null;
  const shownLogo = remove ? null : (file?.url ?? logoUrl);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        {p.el}
        {a.el}
        {warn && (
          <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            El color principal es claro y los enlaces se leerían mal sobre blanco. Para el texto se usará {warn.suggestion}, un tono más oscuro del mismo color.
          </p>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="logo" className="font-medium text-slate-700">Logo (PNG, WebP o JPG, hasta 512 KB)</label>
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/webp,image/jpeg"
            aria-invalid={logoField.invalid || !!file?.error || undefined}
            aria-describedby="logo-help"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return setFile(null);
              setRemove(false);
              const error = f.size > LOGO_MAX_BYTES ? "El archivo pesa más de 512 KB. Redúcelo o expórtalo como WebP." : !["image/png", "image/webp", "image/jpeg"].includes(f.type) ? "Usa un archivo PNG, WebP o JPG." : undefined;
              if (error) e.target.setCustomValidity(error);
              else e.target.setCustomValidity("");
              setFile({ url: URL.createObjectURL(f), error });
            }}
            className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm ${logoField.invalid || file?.error ? "border-red-500 bg-red-50" : ""}`}
          />
          <p id="logo-help" className={`text-xs ${file?.error ? "text-red-700" : "text-slate-600"}`}>
            {file?.error ?? "Se ve mejor un logo horizontal con fondo transparente. Si no subes uno, se muestran las iniciales de la agencia."}
          </p>
          {logoUrl && !file && (
            <label className="mt-1 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="removeLogo" value="1" checked={remove} onChange={(e) => setRemove(e.target.checked)} className="size-4" />
              Quitar el logo actual
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass}>Guardar marca</button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              p.setValue(DEFAULT_PRIMARY);
              a.setValue(DEFAULT_ACCENT);
            }}
          >
            Volver a los colores de fábrica
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Vista previa</p>
        <style>{previewCss}</style>
        <div className="brand-preview overflow-hidden rounded border border-line bg-canvas" aria-label="Vista previa de la marca">
          <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
            {shownLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownLogo} alt="" className="h-7 max-w-[120px] object-contain" />
            ) : (
              <span className="flex size-7 items-center justify-center rounded bg-brand text-xs font-bold text-brand-contrast">{initials}</span>
            )}
            <span className="text-sm font-semibold text-slate-900">{agencyName}</span>
          </div>
          <div className="flex gap-1 border-b-[3px] border-brand bg-surface px-2 text-xs">
            <span className="-mb-[3px] border-b-[3px] border-accent bg-brand-softer px-2 py-1.5 font-semibold text-slate-900">Mi día</span>
            <span className="px-2 py-1.5 text-slate-700">Contactos</span>
            <span className="px-2 py-1.5 text-slate-700">Oportunidades</span>
          </div>
          <div className="flex flex-col gap-3 p-3">
            <div className="flex">
              <span className="chevron-first bg-emerald-100 px-4 py-1 text-xs text-emerald-900">Nuevo</span>
              <span className="chevron -ml-2 bg-brand px-4 py-1 text-xs font-semibold text-brand-contrast">Contactado</span>
              <span className="chevron -ml-2 bg-slate-200 px-4 py-1 text-xs text-slate-700">Propuesta</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface p-2 text-sm">
              <span className="flex-1 text-brand-text underline-offset-2 hover:underline">María Pérez · Cartagena</span>
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-text">Etapa: Contactado</span>
              <span className="inline-flex items-center gap-1 rounded border border-accent px-2 py-0.5 text-xs font-semibold text-accent-text">Definir paso <Icon name="arrow" className="size-3" /></span>
              <span className="rounded bg-brand px-3 py-1 text-xs font-medium text-brand-contrast">Guardar</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-600">Así verán el sistema todas las personas de la agencia. El tema oscuro ajusta los tonos solo.</p>
      </div>
    </div>
  );
}
