// Mensajes de validación del navegador en español (informe de QA, 2 nov 2026).
import { describe, expect, it } from "vitest";
import { formatLimit, validationMessage, type ValidityLike } from "../../src/domain/validation";

const ok: ValidityLike = {
  valueMissing: false, typeMismatch: false, patternMismatch: false, tooLong: false, tooShort: false,
  rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false,
};
const v = (k: keyof ValidityLike) => ({ ...ok, [k]: true });

describe("validationMessage", () => {
  it("campo obligatorio vacío: nombra el campo y dice qué hacer, nunca en inglés", () => {
    expect(validationMessage(v("valueMissing"), { tag: "input", label: "Resultado" })).toBe("Completa «Resultado»: es obligatorio.");
    expect(validationMessage(v("valueMissing"), { tag: "input", label: "Motivo de cancelación *" })).toBe("Completa «Motivo de cancelación»: es obligatorio.");
    expect(validationMessage(v("valueMissing"), { tag: "textarea" })).toBe("Completa este campo: es obligatorio.");
    expect(validationMessage(v("valueMissing"), { tag: "select", label: "Motivo" })).toBe("Elige una opción en «Motivo».");
    expect(validationMessage(v("valueMissing"), { tag: "input", type: "checkbox" })).toBe("Marca esta casilla para continuar.");
    expect(validationMessage(v("valueMissing"), { tag: "input", type: "datetime-local" })).toBe("Completa la fecha: es obligatorio.");
  });

  it("formato, longitud, rangos y pasos", () => {
    expect(validationMessage(v("typeMismatch"), { tag: "input", type: "email" })).toMatch(/correo válido/);
    expect(validationMessage(v("tooShort"), { tag: "input", minLength: 8, length: 3 })).toBe("Escribe al menos 8 caracteres (llevas 3).");
    expect(validationMessage(v("tooLong"), { tag: "textarea", maxLength: 1000 })).toBe("Usa como máximo 1000 caracteres.");
    expect(validationMessage(v("rangeUnderflow"), { tag: "input", type: "number", min: "1" })).toBe("El valor mínimo es 1.");
    expect(validationMessage(v("rangeOverflow"), { tag: "input", type: "number", max: "500" })).toBe("El valor máximo es 500.");
    expect(validationMessage(v("rangeUnderflow"), { tag: "input", type: "date", min: "2026-11-02" })).toBe("No puede ser antes de 02/11/2026.");
    expect(validationMessage(v("stepMismatch"), { tag: "input", type: "number" })).toBe("Escribe un número entero, sin decimales.");
    expect(validationMessage(v("stepMismatch"), { tag: "input", type: "number", step: "0.01" })).toBe("Usa un valor en pasos de 0.01.");
    expect(validationMessage(v("badInput"), { tag: "input", type: "number" })).toMatch(/solo números/);
    expect(validationMessage(v("patternMismatch"), { tag: "input", title: "Usa HH:MM" })).toBe("Usa HH:MM");
    expect(validationMessage(v("patternMismatch"), { tag: "input" })).toMatch(/formato no es válido/);
  });

  it("un campo válido no lleva mensaje", () => {
    expect(validationMessage(ok, { tag: "input" })).toBeNull();
  });

  it("formatLimit muestra fechas como en Colombia", () => {
    expect(formatLimit("2026-11-02T08:30")).toBe("02/11/2026 08:30");
    expect(formatLimit("15")).toBe("15");
  });
});
