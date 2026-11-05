import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionForm, Input } from "@/components/form";
import { Card, Field, Notice, PageHeader, buttonClass, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { chatSnippet } from "@/domain/chat";
import { embedSnippet } from "@/domain/inbox";
import { firstParams } from "@/domain/params";
import { can } from "@/domain/permissions";
import { getInboxSettings } from "@/server/inbox";
import { requireActiveAgency } from "@/server/session";
import { Flash, type SearchParams } from "../../crm-ui";
import { updateInboxSettingsAction } from "../../inbox-actions";
import { ActiveCheckbox } from "./active-checkbox";
import { CopyField } from "./copy-field";

/** Configuración › Canales de entrada (SPEC-003, alcance 13). Solo administradores. */
export default async function CanalesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  if (!can(active.role, "inbox.manage")) redirect("/app?error=permission_denied");
  const sp = firstParams(await searchParams);
  const s = await withUser(getDb(), user, (tx) => getInboxSettings(tx, user.id, active.agencyId));
  const h = await headers();
  // El enlace usa la dirección por la que se abrió esta página (también sirve en la vista previa).
  const origin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "");
  const formUrl = s.form ? `${origin}/f/${s.form.publicKey}` : null;
  const chatScript = s.chat ? `${origin}/c/${s.chat.publicKey}/burbuja.js` : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="inbox" eyebrow={<Link href="/app/bandeja" className={linkButtonClass}>Bandeja</Link>} title="Canales de entrada">
        <p className="text-sm text-slate-600">Por dónde llegan los mensajes a la bandeja de {active.agencyName} y cuánto pueden esperar una respuesta.</p>
      </PageHeader>
      <Flash sp={sp} />

      <ActionForm action={updateInboxSettingsAction} className="flex flex-col gap-4">
        <Card title="1. Formulario web" icon="form">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-700">
              Cada envío crea el contacto (o usa el que ya existe con ese teléfono o correo), una oportunidad en la primera etapa del embudo con sus tareas de seguimiento, y una conversación en la bandeja.
            </p>
            <ActiveCheckbox saved={s.form?.active ?? false} />
            {formUrl && (
              <>
                <CopyField id="enlace-formulario" label="Enlace del formulario (para botones, redes o la firma del correo)" value={formUrl} />
                <CopyField id="codigo-formulario" label="Código para ponerlo dentro de la web de la agencia" value={embedSnippet(formUrl)} multiline />
                <p className="text-sm">
                  <a href={formUrl} target="_blank" rel="noopener noreferrer" className={linkButtonClass}>Abrir el formulario en otra pestaña</a>
                </p>
              </>
            )}
          </div>
        </Card>

        <Card title="2. Chat web" icon="message">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-700">
              Una burbuja en la web de la agencia. El visitante deja su nombre y su teléfono o correo, y conversa con el equipo; lo que respondes en la bandeja le aparece en la misma ventana. El chat no crea oportunidad: la creas tú desde la conversación si es una consulta de viaje.
            </p>
            <ActiveCheckbox saved={s.chat?.active ?? false} name="chatActive" label="Recibir mensajes por el chat" />
            {!s.chat?.active && <p className="text-sm text-slate-600">El chat está apagado: la burbuja avisa que no está recibiendo mensajes. Pruébalo primero y enciéndelo cuando estés listo.</p>}
            {chatScript && (
              <>
                <CopyField id="codigo-chat" label="Código para pegar en la web de la agencia, antes de </body>" value={chatSnippet(chatScript)} multiline />
                <p className="text-sm">
                  <Link href="/app/configuracion/canales/prueba-chat" className={linkButtonClass}>Probar el chat en una página de ejemplo</Link>
                </p>
              </>
            )}
          </div>
        </Card>

        <Card title="3. Aviso de privacidad" icon="shield">
          <div className="flex flex-col gap-2">
            <Field label="Enlace al aviso de privacidad de la agencia">
              <Input name="privacyUrl" type="url" defaultValue={s.privacyUrl ?? ""} maxLength={500} placeholder="https://www.tuagencia.com/privacidad" />
            </Field>
            {!s.privacyUrl && <Notice>Mientras no pongas el enlace, el formulario y el chat muestran un texto de ejemplo marcado como borrador. Antes de recibir clientes reales, publica el aviso de la agencia y pega aquí su enlace.</Notice>}
          </div>
        </Card>

        <Card title="4. Tiempo máximo sin respuesta" icon="clock">
          <div className="flex flex-col gap-2">
            <Field label="Minutos (en horario laboral)">
              <Input name="maxMinutes" type="number" min={5} max={1440} step={1} required defaultValue={s.maxMinutes} className="max-w-32" />
            </Field>
            <p className="text-sm text-slate-600">
              Si un cliente espera más que esto, su conversación sale en rojo como <b>sin responder</b> y tú ves la alerta. El reloj solo corre dentro del horario de la agencia (<Link href="/app/seguimientos" className={linkButtonClass}>Seguimientos › Horario</Link>). Aplica a los mensajes que lleguen desde ahora.
            </p>
          </div>
        </Card>

        <Card title="Próximamente" icon="message">
          <p className="text-sm text-slate-600">El correo de la agencia llega en la siguiente entrega. WhatsApp, Instagram y Messenger, cuando Meta apruebe la cuenta.</p>
        </Card>

        <div>
          <button className={buttonClass}>Guardar</button>
        </div>
      </ActionForm>
    </div>
  );
}
