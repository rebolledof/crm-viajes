// SPEC-002 · reglas puras: teléfonos, dinero, cierre, tareas y WhatsApp
import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount } from "@/domain/money";
import { formatPhone, normalizePhone } from "@/domain/phone";
import { closeRequirement, missingKinds } from "@/domain/pipeline";
import { dueState, endOfLocalDay } from "@/domain/tasks";
import { fillWhatsappTemplate, whatsappAllowed, whatsappLink } from "@/domain/whatsapp";

describe("teléfonos (RF-203, AC-203)", () => {
  it("normaliza números colombianos escritos de varias formas al mismo E.164", () => {
    for (const raw of ["300 000 0000", "+57 300-000-0000", "(+57) 3000000000", "3000000000"]) {
      expect(normalizePhone(raw)).toBe("+573000000000");
    }
  });
  it("respeta el indicativo de otro país", () => {
    expect(normalizePhone("+34 612 345 678")).toBe("+34612345678");
  });
  it("rechaza números inválidos o vacíos", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("hola")).toBeNull();
    expect(normalizePhone("  ")).toBeNull();
  });
  it("muestra el número legible", () => {
    expect(formatPhone("+573000000000")).toBe("+57 300 0000000");
  });
});

describe("presupuesto con decimales exactos (RF-207, RF-12)", () => {
  it("acepta formato colombiano y lo guarda exacto", () => {
    expect(parseAmount("4.500.000", "COP")).toBe("4500000");
    expect(parseAmount("$ 1.250,50", "USD")).toBe("1250.50");
    expect(parseAmount("1,250.50", "USD")).toBe("1250.50");
    expect(parseAmount("1250", "USD")).toBe("1250.00");
  });
  it("COP no admite centavos y no hay importes negativos ni texto", () => {
    expect(parseAmount("1000,5", "COP")).toBeNull();
    expect(parseAmount("-10", "USD")).toBeNull();
    expect(parseAmount("mucho", "USD")).toBeNull();
    expect(parseAmount("0.001", "USD")).toBeNull();
  });
  it("no pierde precisión con coma flotante", () => {
    expect(parseAmount("0.1", "USD")).toBe("0.10");
    expect(parseAmount("999999999999.99", "USD")).toBe("999999999999.99");
  });
  it("formatea con separadores colombianos", () => {
    expect(formatMoney("4500000", "COP")).toBe("COP 4.500.000");
    expect(formatMoney("1250.5", "USD")).toBe("USD 1.250,50");
  });
});

describe("cierre según el tipo de etapa (RF-208, RF-209, AC-207, AC-208)", () => {
  it("perdida exige motivo y 'otro' exige nota", () => {
    expect(closeRequirement("perdida", {})).toBe("lost_reason_required");
    expect(closeRequirement("perdida", { lostReason: "otro", lostNote: "  " })).toBe("lost_note_required");
    expect(closeRequirement("perdida", { lostReason: "otro", lostNote: "Viaja con familia" })).toBeNull();
    expect(closeRequirement("perdida", { lostReason: "precio" })).toBeNull();
  });
  it("ganada exige evidencia", () => {
    expect(closeRequirement("ganada", {})).toBe("won_evidence_required");
    expect(closeRequirement("ganada", { wonEvidence: "Reserva ABC123" })).toBeNull();
  });
  it("abierta no exige nada", () => {
    expect(closeRequirement("abierta", {})).toBeNull();
  });
  it("detecta tipos sin etapa activa (RF-215)", () => {
    expect(missingKinds([{ kind: "abierta", active: true }, { kind: "ganada", active: false }, { kind: "perdida", active: true }])).toEqual(["ganada"]);
  });
});

describe("vencimientos en hora de Colombia (RF-210)", () => {
  // 2026-11-02 20:00 en Bogotá = 2026-11-03 01:00 UTC
  const now = new Date("2026-11-03T01:00:00Z");
  it("el día termina a medianoche de Bogotá", () => {
    expect(endOfLocalDay(now).toISOString()).toBe("2026-11-03T05:00:00.000Z");
  });
  it("clasifica vencidas, de hoy y próximas", () => {
    expect(dueState(new Date("2026-11-03T00:00:00Z"), now)).toBe("vencida");
    expect(dueState(new Date("2026-11-03T04:00:00Z"), now)).toBe("hoy");
    expect(dueState(new Date("2026-11-03T06:00:00Z"), now)).toBe("proxima");
  });
});

describe("botón de WhatsApp (RF-212, AC-211)", () => {
  it("rellena la plantilla con el primer nombre, la agencia y el destino", () => {
    expect(fillWhatsappTemplate("Hola {nombre}, te escribo de {agencia} por tu viaje a {destino}.", { nombre: "María José Pérez", agencia: "Viajes Andes", destino: "Cartagena" }))
      .toBe("Hola María, te escribo de Viajes Andes por tu viaje a Cartagena.");
  });
  it("sin destino quita la parte del viaje", () => {
    expect(fillWhatsappTemplate("Hola {nombre}, te escribo de {agencia} por tu viaje a {destino}.", { nombre: "Ana", agencia: "Viajes Andes" }))
      .toBe("Hola Ana, te escribo de Viajes Andes.");
  });
  it("arma el enlace oficial wa.me con el texto codificado", () => {
    expect(whatsappLink("+573000000000", "Hola Ana & cía")).toBe("https://wa.me/573000000000?text=Hola%20Ana%20%26%20c%C3%ADa");
  });
  it("solo se bloquea si retiró WhatsApp para servicio", () => {
    expect(whatsappAllowed([])).toBe(true);
    expect(whatsappAllowed([{ channel: "whatsapp", purpose: "promociones", status: "retirado" }])).toBe(true);
    expect(whatsappAllowed([{ channel: "whatsapp", purpose: "servicio", status: "retirado" }])).toBe(false);
  });
});
