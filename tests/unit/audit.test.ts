// Auditoría en lenguaje de la agencia (informe de QA, 2 nov 2026).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeAudit, type AuditEventLike } from "../../src/domain/audit";

const ev = (action: string, changes: Record<string, unknown> = {}, extra: Partial<AuditEventLike> = {}): AuditEventLike => ({
  action, objectType: "x", objectId: "id-1", changes, reason: null, ...extra,
});
const names = {
  member: (id: string) => ({ u1: "ana@agencia.test" })[id],
  stage: (id: string) => ({ "id-1": "Nuevo", s2: "Ganado" })[id],
  contact: (id: string) => ({ "id-1": "Laura Gómez", c9: "Pedro Ruiz" })[id],
  opportunity: (id: string) => ({ "id-1": "Laura Gómez · Cartagena" })[id],
  task: (id: string) => ({ "id-1": "Llamar al cliente" })[id],
  template: (id: string) => ({ "id-1": "Bienvenida", t2: "Cierre" })[id],
};
const text = (e: AuditEventLike) => describeAudit(e, names).text;

describe("describeAudit", () => {
  it("el ejemplo del informe: activar una etapa se lee como frase", () => {
    expect(describeAudit(ev("stage.updated", { active: true }), names)).toEqual({ text: "Activó la etapa «Nuevo»", details: [] });
    expect(text(ev("stage.updated", { active: false }))).toBe("Desactivó la etapa «Nuevo»");
    expect(text(ev("stage.updated", { name: "Primer contacto" }))).toBe("Renombró la etapa a «Primer contacto»");
  });

  it("oportunidades, tareas, consentimientos y WhatsApp con nombres y detalles legibles", () => {
    const moved = describeAudit(ev("opportunity.stage_changed", { de: "Negociación", a: "Perdido", motivo: "precio", nota: "Muy caro" }), names);
    expect(moved.text).toBe("Movió la oportunidad «Laura Gómez · Cartagena» de «Negociación» a «Perdido»");
    expect(moved.details).toEqual(["Motivo de pérdida: Precio", "Nota: Muy caro"]);
    expect(describeAudit(ev("opportunity.created", { contactId: "c9", stage: "Nuevo", destination: "Lima" }), names).details).toEqual(["Destino: Lima", "Etapa: Nuevo"]);
    expect(describeAudit(ev("task.completed", { result: "Le envié opciones" }), names)).toEqual({ text: "Completó la tarea «Llamar al cliente»", details: ["Resultado: Le envié opciones"] });
    expect(describeAudit(ev("task.cancelled", {}, { reason: "Duplicada" }), names).details).toEqual(["Motivo: Duplicada"]);
    expect(describeAudit(ev("task.updated", { vence: "2026-11-03T15:00:00.000Z", prioridad: "alta", asignada: "u1" }), names).details).toEqual([
      expect.stringMatching(/^Nueva fecha: 3\/11\/2026, 10:00/),
      "Prioridad: Alta",
      "Asignada a: ana@agencia.test",
    ]);
    expect(text(ev("consent.recorded", { channel: "whatsapp", purpose: "servicio", status: "retirado", source: "Lo pidió" }))).toBe("Retiró el permiso de WhatsApp para atención del viaje de «Laura Gómez»");
    expect(describeAudit(ev("whatsapp.opened", { phone: "+573101112233" }), names).details[0]).toMatch(/^Teléfono: /);
    expect(text(ev("membership.role_changed", { role: "asesor" }, { objectId: "u1" }))).toBe("Cambió el rol de ana@agencia.test a Asesor");
  });

  it("seguimientos y ajustes", () => {
    expect(text(ev("followup.template_updated", { active: false }))).toBe("Desactivó la plantilla «Bienvenida»");
    const created = describeAudit(ev("followup.template_created", { name: "VIP", trigger: "etapa", stageId: "s2", editLevel: "bloqueada", ownerId: "u1" }), names);
    expect(created.text).toBe("Creó la plantilla personal «VIP»");
    expect(created.details).toEqual([expect.stringMatching(/^Se activa cuando: /), "Etapa: Ganado", "Edición por asesores: Bloqueada"]);
    expect(describeAudit(ev("followup.step_created", { title: "Llamar", kind: "llamada", delayAmount: 2, delayUnit: "dias_habiles", atTime: "10:00:00", priority: "media" }), names)).toMatchObject({
      text: "Agregó el paso «Llamar» a la plantilla «Bienvenida»",
      details: expect.arrayContaining(["Prioridad: Media"]),
    });
    expect(text(ev("followup.applied", { template: "t2", tasks: 3 }))).toBe("Se aplicó la plantilla «Cierre» a la oportunidad «Laura Gómez · Cartagena»");
    expect(describeAudit(ev("settings.updated", { weekdayStart: "08:00:00", weekdayEnd: "18:00:00", saturdayStart: null, saturdayEnd: null, allowPersonalTemplates: true }), names).details).toEqual([
      "Lunes a viernes: 08:00 a 18:00",
      "Sábados: sin atención",
      "Plantillas propias de asesores: permitidas",
    ]);
  });

  it("si el objeto ya no existe o la acción es nueva, se lee igual y nunca como JSON", () => {
    expect(describeAudit(ev("task.completed", {}), {}).text).toBe("Completó una tarea");
    expect(describeAudit(ev("membership.revoked"), {}).text).toBe("Quitó el acceso a una persona que ya no está en la agencia");
    const unknown = describeAudit(ev("algo.nuevo", { visible: true, nested: { a: 1 } }), names);
    expect(unknown.text).toBe("Acción registrada (algo.nuevo)");
    expect(unknown.details).toEqual(["visible: sí"]);
    expect(JSON.stringify(unknown)).not.toContain("{\\\"");
  });

  it("cada acción que escribe el código o la base tiene su frase (evita volver al texto técnico)", () => {
    const files = [
      ...readdirSync("src/server").map((f) => `src/server/${f}`),
      ...readdirSync("supabase/migrations").map((f) => `supabase/migrations/${f}`),
    ];
    const found = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/action: "([a-z_]+\.[a-z_]+)"/g)) found.add(m[1]);
      for (const m of src.matchAll(/'([a-z_]+\.[a-z_]+)', '(?:agency|invitation|membership|opportunity|stage|contact|task|followup_template)'/g)) found.add(m[1]);
    }
    expect(found.size).toBeGreaterThan(20);
    for (const a of found) expect(describeAudit(ev(a), names).text, a).not.toMatch(/^Acción registrada/);
  });
});
