import Link from "next/link";
import { ActionForm, Input, Select, Textarea } from "@/components/form";
import { Card, Field, Notice, PageHeader, buttonClass, linkButtonClass } from "@/components/ui";
import { getDb, withUser } from "@/db/client";
import { firstParams } from "@/domain/params";
import { can } from "@/domain/permissions";
import { listSavedReplies } from "@/server/inbox";
import { requireActiveAgency } from "@/server/session";
import { Flash, type SearchParams } from "../../crm-ui";
import { createSavedReplyAction, deleteSavedReplyAction, updateSavedReplyAction } from "../../inbox-actions";

/**
 * Respuestas guardadas (SPEC-003, alcance 11): las de la agencia las escribe el administrador;
 * cada asesor puede tener las suyas, que solo ve él. Se usan escribiendo "/" en la bandeja.
 */
export default async function RespuestasPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = firstParams(await searchParams);
  const replies = await withUser(getDb(), user, (tx) => listSavedReplies(tx, user.id, active.agencyId));
  const isAdmin = can(active.role, "inbox.manage");
  const canWrite = can(active.role, "crm.write");
  const agency = replies.filter((r) => !r.ownerId);
  const mine = replies.filter((r) => r.ownerId === user.id);

  const item = (r: (typeof replies)[number]) => {
    const editable = r.ownerId ? canWrite : isAdmin;
    return (
      <li key={r.id} className="border-b border-slate-100 py-3 last:border-b-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{r.title}</span>
          <code className="rounded bg-slate-100 px-1.5 text-xs text-slate-700">/{r.shortcut}</code>
        </div>
        <p className="mt-1 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-slate-700">{r.body}</p>
        {editable && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium text-brand-text">Editar</summary>
            <ActionForm action={updateSavedReplyAction} className="mt-2 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="replyId" value={r.id} />
              <Field label="Título">
                <Input name="replyTitle" defaultValue={r.title} required maxLength={80} />
              </Field>
              <Field label="Atajo (se escribe con /)">
                <Input name="shortcut" defaultValue={r.shortcut} required maxLength={31} pattern="/?[a-zA-Z0-9_\-]{1,30}" title="Letras, números, guion o guion bajo, sin espacios" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Texto">
                  <Textarea name="replyBody" defaultValue={r.body} required maxLength={2000} rows={4} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button className={buttonClass}>Guardar cambios</button>
              </div>
            </ActionForm>
            <form action={deleteSavedReplyAction} className="mt-2">
              <input type="hidden" name="replyId" value={r.id} />
              <ConfirmDelete />
            </form>
          </details>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon="zap" eyebrow={<Link href="/app/bandeja" className={linkButtonClass}>Bandeja</Link>} title="Respuestas guardadas">
        <p className="text-sm text-slate-600">
          En la bandeja, escribe <code className="rounded bg-slate-100 px-1">/</code> y el atajo para insertar una. <code className="rounded bg-slate-100 px-1">{"{nombre}"}</code>, <code className="rounded bg-slate-100 px-1">{"{asesor}"}</code> y <code className="rounded bg-slate-100 px-1">{"{agencia}"}</code> se reemplazan solos, y puedes editar el texto antes de enviar.
        </p>
      </PageHeader>
      <Flash sp={sp} />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Card title={`De la agencia (${agency.length})`} icon="building" bodyClassName="px-4">
            {agency.length === 0 ? (
              <div className="py-3">
                <Notice>{isAdmin ? "No hay respuestas de la agencia. Crea la primera con el formulario de la derecha." : "El administrador aún no ha creado respuestas de la agencia. Puedes crear las tuyas."}</Notice>
              </div>
            ) : (
              <ul>{agency.map(item)}</ul>
            )}
          </Card>
          <Card title={`Mías (${mine.length})`} icon="users" bodyClassName="px-4">
            {mine.length === 0 ? (
              <div className="py-3">
                <Notice>{canWrite ? "No tienes respuestas personales. Crea las que más repites; solo tú las ves." : "Tu rol es de solo lectura: no puedes crear respuestas."}</Notice>
              </div>
            ) : (
              <ul>{mine.map(item)}</ul>
            )}
          </Card>
        </div>

        {canWrite && (
          <Card title="Nueva respuesta" icon="plus">
            <ActionForm action={createSavedReplyAction} className="flex flex-col gap-3">
              {isAdmin ? (
                <Field label="Para quién">
                  <Select name="scope" defaultValue="agencia">
                    <option value="agencia">Toda la agencia</option>
                    <option value="mia">Solo para mí</option>
                  </Select>
                </Field>
              ) : (
                <input type="hidden" name="scope" value="mia" />
              )}
              <Field label="Título">
                <Input name="replyTitle" required maxLength={80} placeholder="Ej.: Seguro de viaje" />
              </Field>
              <Field label="Atajo (se escribe con /)">
                <Input name="shortcut" required maxLength={31} pattern="/?[a-zA-Z0-9_\-]{1,30}" title="Letras, números, guion o guion bajo, sin espacios" placeholder="Ej.: seguro" />
              </Field>
              <Field label="Texto">
                <Textarea name="replyBody" required maxLength={2000} rows={5} placeholder="Hola {nombre}, …" />
              </Field>
              <button className={buttonClass}>Crear respuesta</button>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}

function ConfirmDelete() {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-red-700">Borrar esta respuesta</summary>
      <p className="mt-1 text-sm text-slate-700">No se puede deshacer. Los mensajes ya enviados no cambian.</p>
      <button className="mt-1 rounded border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50">Sí, borrar</button>
    </details>
  );
}
