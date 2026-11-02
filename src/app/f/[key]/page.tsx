import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, Input, Textarea } from "@/components/form";
import { Icon } from "@/components/icons";
import { Field, Notice, buttonClass } from "@/components/ui";
import { getDb, withAnon } from "@/db/client";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, agencyInitials, brandCssVars, cssBlock, normalizeHex } from "@/domain/branding";
import { firstParams } from "@/domain/params";
import { webFormInfo } from "@/server/public-form";
import { submitWebFormAction } from "./actions";
import { PrivacyCheckbox } from "./privacy-checkbox";

export const metadata: Metadata = { title: "Pide tu cotización", robots: { index: false, follow: false } };

type Props = { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Formulario web público de la agencia (SPEC-003, alcance 6). Lleva su nombre, logo y colores; se
 * enlaza o se pone dentro de la web de la agencia (?embed=1 quita el fondo de página).
 */
export default async function WebFormPage({ params, searchParams }: Props) {
  const { key } = await params;
  const sp = firstParams(await searchParams);
  const info = await withAnon(getDb(), (tx) => webFormInfo(tx, key));
  if (!info) notFound();
  const embed = sp.embed === "1";
  const vars = brandCssVars({ primary: normalizeHex(info.primary) ?? DEFAULT_PRIMARY, accent: normalizeHex(info.accent) ?? DEFAULT_ACCENT });

  return (
    <div className={`flex min-h-screen flex-col items-center px-4 ${embed ? "bg-transparent py-4" : "bg-canvas py-8"}`}>
      <style dangerouslySetInnerHTML={{ __html: cssBlock(":root", vars.light) }} />
      <div className="w-full max-w-xl rounded border border-line bg-surface shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
        <header className="flex items-center gap-3 border-b-[3px] border-brand px-5 py-4">
          {info.hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo servido por la app; no pasa por el optimizador
            <img src={`/f/${key}/logo?v=${info.logoVersion}`} alt="" className="size-10 rounded object-contain" />
          ) : (
            <span aria-hidden className="flex size-10 items-center justify-center rounded bg-brand text-sm font-bold text-brand-contrast">{agencyInitials(info.agencyName)}</span>
          )}
          <div>
            <p className="font-bold text-slate-900">{info.agencyName}</p>
            <h1 className="text-sm text-slate-600">Pide tu cotización de viaje</h1>
          </div>
        </header>
        <div className="px-5 py-5">
          {sp.enviado === "1" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
              <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <Icon name="done" className="size-6" />
              </span>
              <p className="text-lg font-semibold text-slate-900">¡Recibimos tu consulta!</p>
              <p className="text-sm text-slate-700">Un asesor de {info.agencyName} te responderá en horario de atención por WhatsApp o por correo.</p>
              <a href={`/f/${key}${embed ? "?embed=1" : ""}`} className="text-sm font-medium text-brand-text underline">Enviar otra consulta</a>
            </div>
          ) : !info.active ? (
            <Notice>Este formulario no está recibiendo consultas por ahora. Escríbenos por otro medio de contacto de la agencia.</Notice>
          ) : (
            <ActionForm action={submitWebFormAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="embed" value={embed ? "1" : "0"} />
              {/* Campo trampa para robots: invisible para personas y lectores de pantalla. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  No llenar este campo
                  <input name="hp_contacto" tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" />
                </label>
              </div>
              <p className="text-sm text-slate-600 sm:col-span-2">Déjanos un teléfono o un correo para responderte. Los campos con * son obligatorios.</p>
              <Field label="Nombre">
                <Input name="name" required maxLength={160} autoComplete="name" />
              </Field>
              <Field label="Teléfono (WhatsApp)">
                <Input name="phone" type="tel" maxLength={30} autoComplete="tel" placeholder="300 000 0000" />
              </Field>
              <Field label="Correo">
                <Input name="email" type="email" maxLength={254} autoComplete="email" placeholder="nombre@correo.com" />
              </Field>
              <Field label="Destino">
                <Input name="destination" maxLength={160} placeholder="¿A dónde quieres ir?" />
              </Field>
              <Field label="Fechas aproximadas">
                <Input name="dates" maxLength={200} placeholder="Ej.: junio, 10 días" />
              </Field>
              <Field label="Viajeros">
                <Input name="travelers" type="number" min={1} max={999} step={1} placeholder="Ej.: 2" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Mensaje">
                  <Textarea name="message" rows={4} maxLength={4000} placeholder="Cuéntanos qué tipo de viaje buscas" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <PrivacyCheckbox agencyName={info.agencyName} privacyUrl={info.privacyUrl} />
              </div>
              <div className="sm:col-span-2">
                <button className={buttonClass}>
                  <Icon name="send" className="size-4" /> Enviar consulta
                </button>
              </div>
            </ActionForm>
          )}
        </div>
      </div>
      {!embed && <p className="mt-4 text-xs text-slate-600">Tus datos solo se usan para responder esta consulta.</p>}
    </div>
  );
}
