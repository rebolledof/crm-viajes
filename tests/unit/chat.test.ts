// SPEC-003 parte 2 · Chat web: reglas puras.
import { describe, expect, it } from "vitest";
import { bubbleScript, chatSnippet, isChatToken, offHoursNotice, parseChatMessage, parseChatStart, pollDelay } from "../../src/domain/chat";

const base = { name: "Camila", phone: "300 555 0101", email: "", message: "Hola", privacy: true };

describe("primer mensaje (RF-272, RF-276, AC-285)", () => {
  it("acepta nombre, teléfono y mensaje y normaliza el teléfono", () => {
    expect(parseChatStart(base)).toEqual({ ok: true, data: { name: "Camila", phone: "+573005550101", email: null, message: "Hola" } });
  });

  it("pide teléfono o correo, nombre, mensaje y el aviso, señalando el campo", () => {
    expect(parseChatStart({ ...base, phone: "" })).toMatchObject({ ok: false, error: { field: "phone" } });
    expect(parseChatStart({ ...base, name: " " })).toMatchObject({ ok: false, error: { field: "name" } });
    expect(parseChatStart({ ...base, message: "  " })).toMatchObject({ ok: false, error: { field: "message", message: "Escribe tu mensaje." } });
    expect(parseChatStart({ ...base, privacy: false })).toMatchObject({ ok: false, error: { field: "privacy" } });
    expect(parseChatStart({ ...base, phone: "", email: "malo@" })).toMatchObject({ ok: false, error: { field: "email" } });
  });

  it("AC-285: rechaza más de 4.000 letras diciendo el máximo", () => {
    const r = parseChatMessage("x".repeat(4001));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.message).toContain("4.000");
    expect(parseChatMessage("x".repeat(4000)).ok).toBe(true);
  });
});

describe("llave del visitante", () => {
  it("solo acepta 43 caracteres base64url", () => {
    expect(isChatToken("A".repeat(43))).toBe(true);
    expect(isChatToken("A".repeat(42))).toBe(false);
    expect(isChatToken(`${"A".repeat(42)}=`)).toBe(false);
  });
});

describe("fuera de horario (AC-281)", () => {
  const at = (s: string) => new Date(`${s}Z`);
  it("sin aviso si la agencia está abierta", () => {
    expect(offHoursNotice(true, at("2026-11-03T10:00:00"), at("2026-11-03T10:00:00"))).toBeNull();
  });
  it("dice mañana y la hora si abre al día siguiente", () => {
    expect(offHoursNotice(false, at("2026-11-04T08:00:00"), at("2026-11-03T20:00:00"))).toBe(
      "Estamos fuera de horario. Te respondemos mañana desde las 8:00 a. m. Puedes dejarnos tu mensaje.",
    );
  });
  it("dice hoy si es antes de abrir y el día si es más adelante", () => {
    expect(offHoursNotice(false, at("2026-11-03T08:00:00"), at("2026-11-03T06:30:00"))).toContain("hoy desde las 8:00 a. m.");
    // Sábado 7 nov, 2 p. m. → abre el lunes.
    expect(offHoursNotice(false, at("2026-11-09T08:00:00"), at("2026-11-07T14:00:00"))).toContain("el lunes desde las 8:00 a. m.");
    expect(offHoursNotice(false, at("2026-11-09T14:30:00"), at("2026-11-07T14:00:00"))).toContain("2:30 p. m.");
  });
});

describe("ritmo de consulta (RF-274)", () => {
  it("5 s con actividad, 30 s tras 2 minutos quieto y nada si no se ve", () => {
    expect(pollDelay(true, 10_000)).toBe(5_000);
    expect(pollDelay(true, 3 * 60_000)).toBe(30_000);
    expect(pollDelay(false, 0)).toBeNull();
  });
});

describe("burbuja (AC-288)", () => {
  it("el código para pegar carga el script de la burbuja", () => {
    expect(chatSnippet("https://crm.test/c/abc/burbuja.js")).toBe('<script src="https://crm.test/c/abc/burbuja.js" async></script>');
  });

  it("solo escucha el aviso de cerrar que viene del CRM y no deja inyectar código con el nombre", () => {
    const js = bubbleScript({ origin: "https://crm.test", key: "a".repeat(32), color: "#0F6E6E", agencyName: 'Viajes "X" </script><script>alert(1)</script>' });
    expect(js).toContain('e.origin === origin && e.data === "crm-chat:close"');
    expect(js).not.toContain("</script>");
    expect(js).toContain("\\u003c/script>");
    // Es JavaScript válido.
    expect(() => new Function(js)).not.toThrow();
  });
});
