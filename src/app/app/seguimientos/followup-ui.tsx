// Formularios de plantillas y pasos (SPEC-002b). Componentes de servidor que envían a
// followup-actions.ts; el servidor y la base validan todo otra vez.
import { ActionForm, Input, Select, Textarea, type FormAction } from "@/components/form";
import { Field, buttonClass } from "@/components/ui";
import { DELAY_UNITS, DELAY_UNIT_LABELS, EDIT_LEVELS, EDIT_LEVEL_LABELS, FOLLOWUP_TRIGGERS, TRIGGER_LABELS } from "@/domain/followups";
import { LOSS_REASONS, LOSS_REASON_LABELS } from "@/domain/pipeline";
import { PRIORITIES, PRIORITY_LABELS, TASK_KINDS, TASK_KIND_LABELS } from "@/domain/tasks";

export type StageOption = { id: string; name: string; kind: string };

export type TemplateValues = {
  id?: string;
  name?: string;
  trigger?: string;
  stageId?: string | null;
  lossReasons?: string[];
  stopStageId?: string | null;
  editLevel?: string;
};

export function TemplateForm({ action, stages, values = {}, personal, submit }: { action: FormAction; stages: StageOption[]; values?: TemplateValues; personal?: boolean; submit: string }) {
  const open = stages.filter((s) => s.kind === "abierta");
  return (
    <ActionForm action={action} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
      {values.id && <input type="hidden" name="templateId" value={values.id} />}
      {personal && <input type="hidden" name="personal" value="true" />}
      <div className="sm:col-span-2">
        <Field label="Nombre">
          <Input name="templateName" defaultValue={values.name ?? ""} required maxLength={80} placeholder="Propuesta enviada: seguimiento" />
        </Field>
      </div>
      <Field label="Cuándo se activa">
        <Select name="trigger" defaultValue={values.trigger ?? "etapa"}>
          {FOLLOWUP_TRIGGERS.map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Etapa (solo si se activa al entrar en una etapa)">
        <Select name="stageId" defaultValue={values.stageId ?? ""}>
          <option value="">Elige la etapa</option>
          {open.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Se detiene al llegar a (y cancela lo pendiente)">
        <Select name="stopStageId" defaultValue={values.stopStageId ?? ""}>
          <option value="">Solo al ganar o perder</option>
          {open.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Qué puede cambiar el asesor en estas tareas">
        <Select name="editLevel" defaultValue={values.editLevel ?? "ajustable"}>
          {EDIT_LEVELS.map((l) => (
            <option key={l} value={l}>{EDIT_LEVEL_LABELS[l]}</option>
          ))}
        </Select>
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Solo con estos motivos de pérdida (si se activa al perder; ninguno = todos)</legend>
        <div className="flex flex-wrap gap-4 text-sm text-slate-700">
          {LOSS_REASONS.map((r) => (
            <label key={r} className="flex items-center gap-1">
              <input type="checkbox" name="lossReasons" value={r} defaultChecked={values.lossReasons?.includes(r)} />
              {LOSS_REASON_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <button className={buttonClass}>{submit}</button>
      </div>
    </ActionForm>
  );
}

export type StepValues = {
  id?: string;
  kind?: string;
  title?: string;
  delayAmount?: number;
  delayUnit?: string;
  atTime?: string | null;
  priority?: string;
  message?: string | null;
  locked?: boolean;
};

export function StepForm({ action, templateId, values = {}, submit }: { action: FormAction; templateId: string; values?: StepValues; submit: string }) {
  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-4">
      <input type="hidden" name="templateId" value={templateId} />
      {values.id && <input type="hidden" name="stepId" value={values.id} />}
      <div className="sm:col-span-3">
        <Field label="Qué hay que hacer">
          <Input name="title" defaultValue={values.title ?? ""} required maxLength={200} placeholder="Llamar para resolver dudas" />
        </Field>
      </div>
      <Field label="Tipo">
        <Select name="kind" defaultValue={values.kind ?? "llamada"}>
          {TASK_KINDS.map((k) => (
            <option key={k} value={k}>{TASK_KIND_LABELS[k]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Esperar">
        <Input name="delayAmount" type="number" min={0} max={525600} defaultValue={values.delayAmount ?? 0} required />
      </Field>
      <Field label="Unidad">
        <Select name="delayUnit" defaultValue={values.delayUnit ?? "dias_habiles"}>
          {DELAY_UNITS.map((u) => (
            <option key={u} value={u}>{DELAY_UNIT_LABELS[u]}</option>
          ))}
        </Select>
      </Field>
      <Field label="A una hora fija (opcional, solo días)">
        <Input name="atTime" type="time" defaultValue={values.atTime?.slice(0, 5) ?? ""} />
      </Field>
      <Field label="Prioridad">
        <Select name="priority" defaultValue={values.priority ?? "media"}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-4">
        <Field label="Mensaje sugerido para WhatsApp o correo ({nombre}, {destino} y {agencia} se rellenan solos)">
          <Textarea name="message" defaultValue={values.message ?? ""} rows={2} maxLength={1000} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-3">
        <input type="checkbox" name="locked" defaultChecked={values.locked} />
        Paso bloqueado: el asesor solo puede completarlo, aunque la plantilla permita más
      </label>
      <div className="sm:col-span-1">
        <button className={buttonClass}>{submit}</button>
      </div>
    </ActionForm>
  );
}
