// SPEC-004 parte 3: enviar (alcance 10), respuesta del cliente (alcance 13) y ofrecer marcar la
// oportunidad como ganada cuando el cliente acepta.
import Link from "next/link";
import { ActionForm, Input } from "@/components/form";
import { CancelDialogButton, ConfirmDialog } from "@/components/confirm-dialog";
import { Icon } from "@/components/icons";
import { Field, buttonClass, secondaryButtonClass } from "@/components/ui";
import { PendingButton } from "@/components/unsaved-guard";
import type { Currency } from "@/domain/money";
import { formatAmount, formatDecimal, formatQuoteNumber } from "@/domain/quotes";
import type { getSendPlan } from "@/server/quotes";
import { moveOpportunityAction } from "../../crm-actions";
import { decideQuoteAction, sendQuoteAction } from "../../quote-actions";

type SendPlan = Awaited<ReturnType<typeof getSendPlan>>;

const dangerClass = "inline-flex items-center justify-center gap-2 rounded border border-red-300 bg-surface px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50";

function opportunityLine(plan: SendPlan) {
  switch (plan.reason) {
    case "mueve":
      return <>La oportunidad pasa de «{plan.stageName}» a <strong>«{plan.target?.name}»</strong> y arranca su seguimiento automático.</>;
    case "ya_despues":
      return <>La oportunidad sigue en «{plan.stageName}»: ya está en «Propuesta enviada» o después.</>;
    case "cerrada":
      return <>La oportunidad está cerrada («{plan.stageName}») y no cambia de etapa.</>;
    case "sin_etapa":
      return <>La oportunidad sigue en «{plan.stageName}»: el embudo de la agencia no tiene una etapa activa llamada «Propuesta enviada».</>;
  }
}

/** Botón "Enviar al cliente" con su confirmación: total, avisos de margen y qué pasa con la oportunidad. */
export function SendPanel({
  versionId,
  number,
  version,
  total,
  currency,
  lowMargin,
  minMarginPct,
  plan,
  replaces,
  accepted,
  ready,
}: {
  versionId: string;
  number: number;
  version: number;
  total: string;
  currency: Currency;
  lowMargin: boolean;
  minMarginPct: string;
  plan: SendPlan;
  replaces: number | null;
  /** Versión de esta cotización que el cliente ya aceptó, si hay una. */
  accepted: number | null;
  ready: boolean;
}) {
  if (!ready) {
    return (
      <p className="mt-3 text-sm text-slate-700">
        Corrige lo de arriba y aparecerá el botón <strong>Enviar al cliente</strong>.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <ConfirmDialog title={`¿Enviar la versión ${version}?`} triggerClassName={`${buttonClass} w-full sm:w-auto`} trigger={<><Icon name="arrow" className="size-4" /> Enviar al cliente</>}>
        <ActionForm action={sendQuoteAction} className="flex flex-col gap-3 text-sm">
          <input type="hidden" name="versionId" value={versionId} />
          <p className="text-base">
            Cotización N.º {formatQuoteNumber(number)} · total <strong>{formatAmount(total, currency)}</strong>
          </p>
          {lowMargin && (
            <p className="flex gap-2 rounded bg-amber-50 p-3 text-amber-900" role="status">
              <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
              <span>Hay servicios o un total por debajo del margen mínimo ({formatDecimal(minMarginPct)} %). Es solo un aviso: puedes enviarla igual.</span>
            </p>
          )}
          <ul className="flex list-disc flex-col gap-1 pl-5 text-slate-700">
            <li>Esta versión queda congelada: ya no se pueden cambiar sus servicios, precios ni condiciones. Para un cambio crearás la versión {version + 1}.</li>
            {accepted !== null && (
              <li className="font-medium text-amber-900">El cliente ya aceptó la versión {accepted}. Esa sigue aceptada; esta se enviará como una propuesta más y no podrá marcarse aceptada.</li>
            )}
            {replaces !== null && <li>La versión {replaces}, que ya se había enviado, pasa a «Sustituida».</li>}
            <li>{opportunityLine(plan)}</li>
            <li>El envío queda en la auditoría con tu nombre y la hora.</li>
            <li>El CRM no le escribe al cliente: tú le compartes la cotización por WhatsApp o correo.</li>
          </ul>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <CancelDialogButton className={secondaryButtonClass} />
            <PendingButton className={buttonClass}>Sí, enviar</PendingButton>
          </div>
        </ActionForm>
      </ConfirmDialog>
    </div>
  );
}

/** Versión enviada: marcar lo que respondió el cliente (alcance 13). */
export function ClientAnswer({ versionId, version, expired, bare }: { versionId: string; version: number; expired: boolean; bare?: boolean }) {
  const buttons = (
      <div className={`${bare ? "" : "mt-3 "}flex flex-col gap-2 sm:flex-row sm:flex-wrap`}>
        <ConfirmDialog title={`¿El cliente aceptó la versión ${version}?`} triggerClassName={buttonClass} trigger={<><Icon name="done" className="size-4" /> El cliente aceptó esta versión</>}>
          <ActionForm action={decideQuoteAction} className="flex flex-col gap-3 text-sm">
            <input type="hidden" name="versionId" value={versionId} />
            <input type="hidden" name="decision" value="aceptada" />
            <p>La versión {version} queda como <strong>Aceptada</strong>, con tu nombre y la hora en la auditoría. No se puede deshacer. Después te ofrecemos marcar la oportunidad como ganada.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <CancelDialogButton className={secondaryButtonClass} />
              <PendingButton className={buttonClass}>Sí, la aceptó</PendingButton>
            </div>
          </ActionForm>
        </ConfirmDialog>
        <ConfirmDialog title={`¿El cliente rechazó la versión ${version}?`} triggerClassName={dangerClass} trigger="El cliente la rechazó">
          <ActionForm action={decideQuoteAction} className="flex flex-col gap-3 text-sm">
            <input type="hidden" name="versionId" value={versionId} />
            <input type="hidden" name="decision" value="rechazada" />
            <p>La versión {version} queda como <strong>Rechazada</strong>. No se puede deshacer. Si el cliente quiere otra propuesta, crea una versión nueva.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <CancelDialogButton className={secondaryButtonClass} />
              <PendingButton className={dangerClass}>Sí, la rechazó</PendingButton>
            </div>
          </ActionForm>
        </ConfirmDialog>
      </div>
  );
  if (bare) return buttons;
  return (
    <section className="rounded border border-line bg-surface p-4 shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
      <h2 className="font-semibold text-slate-900">¿Qué respondió el cliente?</h2>
      <p className="mt-1 text-sm text-slate-600">
        {expired ? "La vigencia ya pasó, pero puedes marcar la respuesta si el cliente la dio." : "Cuando el cliente te conteste, márcalo aquí para que el equipo lo vea."}
      </p>
      {buttons}
    </section>
  );
}

/** Cotización aceptada con la oportunidad abierta: ofrecer marcarla ganada (alcance 13). */
export function WinOffer({ opportunityId, wonStageId, number, version, versionId }: { opportunityId: string; wonStageId: string; number: number; version: number; versionId: string }) {
  return (
    <section id="ganada" className="rounded border-2 border-emerald-300 bg-surface p-4 shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <Icon name="done" className="size-5 text-emerald-700" /> ¿Marcamos la oportunidad como ganada?
      </h2>
      <p className="mt-1 mb-3 text-sm text-slate-600">El cliente aceptó. Si ya cerraste la venta, escribe la evidencia (por ejemplo, el número de reserva o el abono).</p>
      <ActionForm action={moveOpportunityAction} className="flex flex-col gap-3">
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <input type="hidden" name="stageId" value={wonStageId} />
        <input type="hidden" name="back" value={`/app/cotizaciones/${versionId}`} />
        <Field label="Evidencia">
          <Input name="wonEvidence" required maxLength={500} defaultValue={`Aceptó la cotización N.º ${formatQuoteNumber(number)}, versión ${version}`} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <PendingButton className={buttonClass}>Marcar ganada</PendingButton>
          <Link href={`/app/oportunidades/${opportunityId}`} className={secondaryButtonClass}>Todavía no</Link>
        </div>
      </ActionForm>
    </section>
  );
}
