"use client";

import { useState } from "react";
import { ActionForm, Input, Select, useField } from "@/components/form";
import { Field, buttonClass } from "@/components/ui";
import { LOSS_REASONS, LOSS_REASON_LABELS, type StageKind } from "@/domain/pipeline";
import { moveOpportunityAction } from "../crm-actions";

type Stage = { id: string; name: string; kind: StageKind };
type Props = { opportunityId: string; currentStageId: string; currentKind: StageKind; stages: Stage[]; back: string };

/** Cambia la etapa pidiendo solo lo que exige el tipo de la etapa destino (RF-208, RF-209, RF-216). */
export function MoveForm(props: Props) {
  return (
    <ActionForm action={moveOpportunityAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="opportunityId" value={props.opportunityId} />
      <input type="hidden" name="back" value={props.back} />
      <MoveFields {...props} />
    </ActionForm>
  );
}

function MoveFields({ currentStageId, currentKind, stages }: Props) {
  // Si el servidor rechazó el cambio, se vuelve a mostrar la etapa y el motivo que se habían elegido.
  const sentStage = useField("stageId", 0, currentStageId).value;
  const sentReason = useField("lostReason").value;
  const [stageId, setStageId] = useState(sentStage);
  const [reason, setReason] = useState(sentReason);
  const target = stages.find((s) => s.id === stageId);
  const reopening = currentKind !== "abierta" && target?.kind === "abierta";
  return (
    <>
      <Field label="Nueva etapa">
        <Select name="stageId" value={stageId} onChange={(e) => setStageId(e.target.value)}>
          {!stages.some((s) => s.id === currentStageId) && <option value={currentStageId}>Etapa actual (desactivada)</option>}
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      {target?.kind === "perdida" && (
        <>
          <Field label="Motivo de pérdida">
            <Select name="lostReason" required value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Elige un motivo</option>
              {LOSS_REASONS.map((r) => (
                <option key={r} value={r}>{LOSS_REASON_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label={reason === "otro" ? "Nota (obligatoria)" : "Nota"}>
            <Input name="lostNote" required={reason === "otro"} />
          </Field>
        </>
      )}
      {target?.kind === "ganada" && (
        <Field label="Evidencia de la aceptación">
          <Input name="wonEvidence" required placeholder="Aceptó por WhatsApp el 19 oct, abono recibido" />
        </Field>
      )}
      {reopening && (
        <Field label="Razón para reabrir">
          <Input name="reason" required />
        </Field>
      )}
      <button className={buttonClass} disabled={stageId === currentStageId}>Mover</button>
    </>
  );
}
