"use client";

import { useState } from "react";
import { Field, buttonClass, inputClass } from "@/components/ui";
import { LOSS_REASONS, LOSS_REASON_LABELS, type StageKind } from "@/domain/pipeline";
import { moveOpportunityAction } from "../crm-actions";

type Stage = { id: string; name: string; kind: StageKind };

/** Cambia la etapa pidiendo solo lo que exige el tipo de la etapa destino (RF-208, RF-209, RF-216). */
export function MoveForm({ opportunityId, currentStageId, currentKind, stages, back, compact }: { opportunityId: string; currentStageId: string; currentKind: StageKind; stages: Stage[]; back: string; compact?: boolean }) {
  const [stageId, setStageId] = useState(currentStageId);
  const [reason, setReason] = useState("");
  const target = stages.find((s) => s.id === stageId);
  const reopening = currentKind !== "abierta" && target?.kind === "abierta";
  return (
    <form action={moveOpportunityAction} className={compact ? "flex flex-col gap-2" : "flex flex-wrap items-end gap-3"}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="back" value={back} />
      <Field label={compact ? "Mover a" : "Nueva etapa"}>
        <select name="stageId" value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputClass}>
          {!stages.some((s) => s.id === currentStageId) && <option value={currentStageId}>Etapa actual (desactivada)</option>}
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      {target?.kind === "perdida" && (
        <>
          <Field label="Motivo de pérdida">
            <select name="lostReason" required value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
              <option value="">Elige un motivo</option>
              {LOSS_REASONS.map((r) => (
                <option key={r} value={r}>{LOSS_REASON_LABELS[r]}</option>
              ))}
            </select>
          </Field>
          <Field label={reason === "otro" ? "Nota (obligatoria)" : "Nota"}>
            <input name="lostNote" required={reason === "otro"} className={inputClass} />
          </Field>
        </>
      )}
      {target?.kind === "ganada" && (
        <Field label="Evidencia de la aceptación">
          <input name="wonEvidence" required placeholder="Aceptó por WhatsApp el 19 oct, abono recibido" className={inputClass} />
        </Field>
      )}
      {reopening && (
        <Field label="Razón para reabrir">
          <input name="reason" required className={inputClass} />
        </Field>
      )}
      <button className={buttonClass} disabled={stageId === currentStageId}>Mover</button>
    </form>
  );
}
