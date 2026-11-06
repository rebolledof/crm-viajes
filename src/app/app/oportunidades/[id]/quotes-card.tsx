import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, Chip, buttonClass, linkButtonClass, type ChipTone } from "@/components/ui";
import type { Currency } from "@/domain/money";
import { QUOTE_STATUS_LABELS, formatAmount, formatQuoteNumber, type QuoteDisplayStatus } from "@/domain/quotes";
import type { listOpportunityQuotes } from "@/server/quotes";
import { PendingButton } from "@/components/unsaved-guard";
import { createQuoteAction } from "../../quote-actions";
import { ClientAnswer } from "../../cotizaciones/[id]/send-panel";

const fechaHora = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });

const TONES: Record<QuoteDisplayStatus, ChipTone> = { borrador: "gray", enviada: "brand", sustituida: "violet", aceptada: "green", rechazada: "red", vencida: "amber" };

/** Tarjeta "Cotizaciones" de la ficha de la oportunidad (SPEC-004 alcance 1 y 13, versión inicial). */
export function QuotesCard({ opportunityId, quotes, canCreate, members }: { opportunityId: string; quotes: Awaited<ReturnType<typeof listOpportunityQuotes>>; canCreate: boolean; members: { userId: string; email: string }[] }) {
  const who = (id: string | null) => (id ? (members.find((m) => m.userId === id)?.email ?? "alguien que ya no está en la agencia") : "");
  const create = canCreate && (
    <form action={createQuoteAction}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <PendingButton className={quotes.length ? linkButtonClass : buttonClass}>
        <Icon name="plus" className="mr-1 inline size-4 align-[-3px]" />
        Nueva cotización
      </PendingButton>
    </form>
  );
  return (
    <Card id="cotizaciones" title={`Cotizaciones${quotes.length ? ` (${quotes.length})` : ""}`} icon="file" actions={quotes.length ? create : undefined} bodyClassName="px-4">
      {quotes.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-4 text-sm text-slate-700">
          <p>
            Todavía no hay cotizaciones para esta oportunidad.{" "}
            {canCreate ? "Crea una: se llena con el cliente, el destino y las fechas de aquí, y le agregas los servicios con su coste y su precio." : "Un asesor o el administrador puede crearla."}
          </p>
          {create}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {quotes.map((q) => {
            const main = q.draft ?? q.current;
            if (!main) return null;
            return (
              <li key={q.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/app/cotizaciones/${main.id}`} className="font-semibold text-brand-text hover:underline">
                    N.º {formatQuoteNumber(q.number)} · {main.title}
                  </Link>
                  <Chip tone={TONES[main.displayStatus]}>{QUOTE_STATUS_LABELS[main.displayStatus]} · versión {main.version}</Chip>
                </div>
                {q.current && (
                  <p className="text-slate-600">
                    Vigente: versión {q.current.version}
                    {q.current.saleTotal ? ` · ${formatAmount(q.current.saleTotal, q.current.saleCurrency as Currency)}` : ""}
                    {q.current.daysToExpire !== null ? ` · vence ${q.current.daysToExpire === 0 ? "hoy" : q.current.daysToExpire === 1 ? "mañana" : `en ${q.current.daysToExpire} días`}` : ""}
                    {q.draft && (
                      <>
                        {" · "}
                        <Link href={`/app/cotizaciones/${q.current.id}`} className={linkButtonClass}>ver la enviada</Link>
                      </>
                    )}
                  </p>
                )}
                {!q.current && <p className="text-slate-600">En borrador: todavía no se ha enviado.</p>}
                {canCreate && q.current?.status === "enviada" && (
                  <div className="mt-1">
                    <ClientAnswer versionId={q.current.id} version={q.current.version} expired={q.current.displayStatus === "vencida"} bare />
                  </div>
                )}
                {q.history.some((h) => h.sentAt) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-brand-text">Historial de versiones ({q.history.length})</summary>
                    <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-slate-200 pl-3">
                      {q.history.map((h) => (
                        <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-slate-900">Versión {h.version}</span>
                          <Chip tone={TONES[h.displayStatus]}>{QUOTE_STATUS_LABELS[h.displayStatus]}</Chip>
                          {h.saleTotal && <span>{formatAmount(h.saleTotal, h.saleCurrency as Currency)}</span>}
                          <span className="text-slate-600">{h.sentAt ? `enviada ${fechaHora.format(h.sentAt)} por ${who(h.sentBy)}` : "sin enviar"}</span>
                          <Link href={`/app/cotizaciones/${h.id}`} className={linkButtonClass}>Ver</Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
