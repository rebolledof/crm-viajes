// SPEC-002b · reglas puras de las plantillas de seguimiento
import { describe, expect, it } from "vitest";
import { channelBlock, describeDelay, fillMessage, mailtoLink, parseTime, taskPermissions } from "../../src/domain/followups";

describe("plantillas de seguimiento (SPEC-002b)", () => {
  it("describe la espera de cada paso", () => {
    expect(describeDelay(15, "minutos")).toBe("15 minutos después");
    expect(describeDelay(1, "horas_habiles")).toBe("1 hora hábil después");
    expect(describeDelay(3, "dias_habiles", "10:00:00")).toBe("3 días hábiles después, a las 10:00");
    expect(describeDelay(0, "dias_habiles")).toBe("El mismo día hábil");
    expect(describeDelay(0, "minutos")).toBe("Al momento");
  });

  it("permisos por nivel: bloqueada solo completa, ajustable mueve, libre reasigna y cancela (RF-226)", () => {
    expect(taskPermissions("asesor", "bloqueada")).toEqual({ complete: true, adjust: false, reassign: false, cancel: false });
    expect(taskPermissions("asesor", "ajustable")).toEqual({ complete: true, adjust: true, reassign: false, cancel: false });
    expect(taskPermissions("asesor", "libre")).toEqual({ complete: true, adjust: true, reassign: true, cancel: true });
    expect(taskPermissions("asesor", null)).toEqual({ complete: true, adjust: true, reassign: true, cancel: true });
    expect(taskPermissions("admin", "bloqueada")).toEqual({ complete: true, adjust: true, reassign: true, cancel: true });
    expect(taskPermissions("lectura", "libre")).toEqual({ complete: false, adjust: false, reassign: false, cancel: false });
  });

  it("rellena el mensaje y quita la preposición si el destino es desconocido", () => {
    const tpl = "Hola {nombre}, recibimos tu solicitud de viaje a {destino}. Te escribo de {agencia}.";
    expect(fillMessage(tpl, { nombre: "Laura Gómez", agencia: "Viajes Andes", destino: "Cartagena" })).toBe(
      "Hola Laura, recibimos tu solicitud de viaje a Cartagena. Te escribo de Viajes Andes.",
    );
    expect(fillMessage(tpl, { nombre: "Laura", agencia: "Viajes Andes", destino: null })).toBe("Hola Laura, recibimos tu solicitud de viaje. Te escribo de Viajes Andes.");
  });

  it("arma el enlace de correo y valida horas", () => {
    expect(mailtoLink("ana@ejemplo.test", "Tu viaje", "Hola Ana")).toBe("mailto:ana@ejemplo.test?subject=Tu%20viaje&body=Hola%20Ana");
    expect(parseTime("9:00")).toBeNull();
    expect(parseTime("09:00")).toBe("09:00");
    expect(parseTime("24:00")).toBeNull();
  });

  it("explica por qué no se puede abrir WhatsApp o correo desde una tarea (informe de QA)", () => {
    const ok = { phone: true, whatsappAllowed: true, email: true, emailAllowed: true };
    expect(channelBlock("whatsapp", ok)).toBeNull();
    expect(channelBlock("correo", ok)).toBeNull();
    expect(channelBlock("llamada", { ...ok, phone: false })).toBeNull();
    expect(channelBlock("whatsapp", { ...ok, whatsappAllowed: false })).toMatch(/retiró el permiso para recibir WhatsApp/);
    expect(channelBlock("whatsapp", { ...ok, phone: false })).toMatch(/no tiene teléfono/);
    expect(channelBlock("correo", { ...ok, emailAllowed: false })).toMatch(/retiró el permiso para recibir correos/);
    expect(channelBlock("correo", { ...ok, email: false })).toMatch(/no tiene correo/);
    // El retiro de WhatsApp no bloquea el correo, ni al revés.
    expect(channelBlock("correo", { ...ok, whatsappAllowed: false })).toBeNull();
    expect(channelBlock("whatsapp", { ...ok, emailAllowed: false })).toBeNull();
    expect(channelBlock("whatsapp", undefined)).toBeNull();
  });
});
