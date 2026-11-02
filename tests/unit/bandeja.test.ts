// SPEC-003 · Reglas puras de la bandeja: estados, siguiente paso, respuestas guardadas y formulario.
import { describe, expect, it } from "vitest";
import { dayPlan } from "@/domain/guide";
import {
  conversationActions,
  conversationGuide,
  conversationStep,
  displayName,
  embedSnippet,
  fillSavedReply,
  isUnanswered,
  matchReplies,
  normalizeShortcut,
  parseWebForm,
  typedShortcut,
  waitLabel,
  type WebFormInput,
} from "@/domain/inbox";

const now = new Date("2026-11-03T15:31:00Z");

describe("sin responder (RF-265)", () => {
  it("solo cuenta una conversación abierta con el plazo vencido", () => {
    expect(isUnanswered({ status: "abierta", replyDueAt: new Date("2026-11-03T15:30:00Z") }, now)).toBe(true);
    expect(isUnanswered({ status: "abierta", replyDueAt: new Date("2026-11-03T15:32:00Z") }, now)).toBe(false);
    expect(isUnanswered({ status: "pendiente", replyDueAt: null }, now)).toBe(false);
    expect(isUnanswered({ status: "resuelta", replyDueAt: null }, now)).toBe(false);
  });

  it("dice cuánto lleva esperando", () => {
    expect(waitLabel(new Date("2026-11-03T15:30:40Z"), now)).toBe("ahora");
    expect(waitLabel(new Date("2026-11-03T14:49:00Z"), now)).toBe("hace 42 min");
    expect(waitLabel(new Date("2026-11-03T12:00:00Z"), now)).toBe("hace 3 h");
    expect(waitLabel(new Date("2026-11-02T10:00:00Z"), now)).toBe("hace 1 día");
    expect(waitLabel(new Date("2026-10-30T10:00:00Z"), now)).toBe("hace 4 días");
  });
});

describe("siguiente paso de la conversación (alcance 12)", () => {
  it("Tomar → Responder → Crear oportunidad → Esperando", () => {
    expect(conversationStep({ status: "abierta", assigneeId: null, opportunityId: "o" })).toBe("tomar");
    expect(conversationStep({ status: "abierta", assigneeId: "ana", opportunityId: "o" })).toBe("responder");
    expect(conversationStep({ status: "pendiente", assigneeId: "ana", opportunityId: null })).toBe("crear_oportunidad");
    expect(conversationStep({ status: "pendiente", assigneeId: "ana", opportunityId: "o" })).toBe("esperando");
    expect(conversationStep({ status: "resuelta", assigneeId: null, opportunityId: null })).toBe("resuelta");
  });

  it("Qué hacer ahora: 1 Responde, 2 Oportunidad, 3 Siguiente paso, con el actual marcado", () => {
    const g = conversationGuide({ status: "abierta", assigneeId: null, opportunityId: "o", openTasks: 4 }, "ana");
    expect(g.map((s) => s.key)).toEqual(["responde", "oportunidad", "siguiente"]);
    expect(g.map((s) => s.state)).toEqual(["actual", "hecho", "hecho"]);
    expect(g[0].detail).toContain("Tómala");
    const g2 = conversationGuide({ status: "pendiente", assigneeId: "ana", opportunityId: null, openTasks: 0 }, "ana");
    expect(g2.map((s) => s.state)).toEqual(["hecho", "actual", "pendiente"]);
    const g3 = conversationGuide({ status: "pendiente", assigneeId: "ana", opportunityId: "o", openTasks: 0 }, "ana");
    expect(g3.map((s) => s.state)).toEqual(["hecho", "hecho", "actual"]);
  });

  it("permisos por rol (RF-267): Lectura solo mira; reasignar es del administrador", () => {
    expect(conversationActions("lectura", "x", { assigneeId: null, status: "abierta" })).toMatchObject({ reply: false, take: false, resolve: false, reassign: false });
    expect(conversationActions("asesor", "ana", { assigneeId: null, status: "abierta" })).toMatchObject({ reply: true, take: true, resolve: true, reassign: false });
    expect(conversationActions("asesor", "ana", { assigneeId: "luis", status: "abierta" }).take).toBe(false);
    expect(conversationActions("admin", "adm", { assigneeId: "luis", status: "resuelta" })).toMatchObject({ reassign: true, resolve: false });
  });

  it("AC-275: Mi día pone primero 'Responde los mensajes' y queda hecho en cero", () => {
    const p = dayPlan({ overdue: 1, today: 0, withoutNext: 0, unanswered: 2 });
    expect(p[0]).toMatchObject({ key: "mensajes", title: "Responde los mensajes", detail: "2 sin responder", state: "actual" });
    const q = dayPlan({ overdue: 1, today: 0, withoutNext: 0, unanswered: 0 });
    expect(q.map((s) => s.state)).toEqual(["hecho", "actual", "pendiente", "pendiente", "pendiente"]);
    // Sin el dato (rol de lectura) el plan sigue con sus 4 pasos de siempre.
    expect(dayPlan({ overdue: 0, today: 0, withoutNext: 0 })).toHaveLength(4);
  });
});

describe("respuestas guardadas (RF-269, AC-271)", () => {
  it("reemplaza {nombre}, {asesor} y {agencia} con el primer nombre", () => {
    expect(fillSavedReply("Hola {nombre}, soy {asesor} de {agencia}", { nombre: "María Ríos", asesor: "Ana Gómez", agencia: "Andes Travel" })).toBe("Hola María, soy Ana de Andes Travel");
  });

  it("reconoce el atajo que se escribe y filtra por atajo o título", () => {
    expect(typedShortcut("/sa")).toBe("sa");
    expect(typedShortcut("/")).toBe("");
    expect(typedShortcut("hola /sa")).toBeNull();
    const list = [
      { shortcut: "saludo", title: "Saludo y pedir datos" },
      { shortcut: "pagos", title: "Formas de pago" },
    ];
    expect(matchReplies(list, "sa").map((r) => r.shortcut)).toEqual(["saludo"]);
    expect(matchReplies(list, "pago").map((r) => r.shortcut)).toEqual(["pagos"]);
    expect(matchReplies(list, "")).toHaveLength(2);
  });

  it("normaliza el atajo y rechaza espacios", () => {
    expect(normalizeShortcut("/Saludo")).toBe("saludo");
    expect(normalizeShortcut("con espacio")).toBeNull();
    expect(normalizeShortcut("")).toBeNull();
    expect(normalizeShortcut("a".repeat(31))).toBeNull();
  });

  it("nombre corto desde el correo", () => {
    expect(displayName("ana.perez@example.com")).toBe("Ana");
    expect(displayName("luis-2@example.com")).toBe("Luis");
  });
});

describe("formulario web (RF-261, RF-271, AC-273)", () => {
  const base: WebFormInput = { name: "Julián", phone: "315 555 0199", email: "", destination: "Madrid", dates: "Junio", travelers: "2", message: "Hola", privacy: true };

  it("normaliza el teléfono colombiano y los números", () => {
    const r = parseWebForm(base);
    expect(r).toEqual({ ok: true, data: { name: "Julián", phone: "+573155550199", email: null, destination: "Madrid", dates: "Junio", travelers: 2, message: "Hola" } });
  });

  it("exige teléfono o correo, aviso de privacidad y datos válidos, señalando el campo", () => {
    const err = (over: Partial<WebFormInput>) => {
      const r = parseWebForm({ ...base, ...over });
      return r.ok ? null : r.error.field;
    };
    expect(err({ phone: "", email: "" })).toBe("phone");
    expect(err({ privacy: false })).toBe("privacy");
    expect(err({ name: "  " })).toBe("name");
    expect(err({ phone: "abc" })).toBe("phone");
    expect(err({ phone: "", email: "no-es-correo" })).toBe("email");
    expect(err({ travelers: "0" })).toBe("travelers");
    expect(err({ travelers: "2.5" })).toBe("travelers");
    expect(err({ message: "x".repeat(4001) })).toBe("message");
    expect(err({ phone: "", email: "Ana@Example.com" })).toBeNull();
  });

  it("el mensaje del aviso dice que lo escrito se conserva", () => {
    const r = parseWebForm({ ...base, privacy: false });
    expect(r.ok ? "" : r.error.message).toContain("se conserva");
  });

  it("el código para incrustar usa el enlace con ?embed=1", () => {
    expect(embedSnippet("https://crm.example.com/f/abc")).toContain('src="https://crm.example.com/f/abc?embed=1"');
  });
});
