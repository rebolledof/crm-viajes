import { isUuid } from "@/domain/params";

/** Errores de negocio estables (briefing 15.3). El mensaje es para la persona usuaria. */
export const ERROR_MESSAGES = {
  permission_denied: "No tienes permiso para hacer esto.",
  not_found: "No encontramos lo que buscas.",
  invalid_input: "Revisa los datos del formulario.",
  conversation_has_opportunity: "Esta conversación ya tiene una oportunidad. Ábrela desde la tarjeta \"Qué hacer ahora\".",
  assignee_read_only: "Esa persona tiene rol de solo lectura y no puede responder. Asigna la conversación a un asesor o administrador.",
  invitation_invalid: "La invitación no es válida: venció, ya se usó, fue revocada o es para otro correo.",
  slug_taken: "Ya existe una agencia con ese nombre. Prueba con otro.",
  not_authenticated: "Tu sesión terminó. Vuelve a iniciar sesión.",
  access_revoked: "Tu acceso a la agencia fue retirado. Pide al administrador una invitación nueva para volver a entrar.",
  duplicate_contact: "Ya existe un contacto con ese teléfono o correo en tu agencia.",
  invalid_phone: "El teléfono no es válido. Escríbelo con indicativo si no es de Colombia.",
  invalid_amount: "El presupuesto no es válido para esa moneda.",
  lost_reason_required: "Para marcarla perdida elige un motivo.",
  lost_note_required: "Con el motivo \"Otro\" escribe una nota.",
  won_evidence_required: "Para marcarla ganada escribe la evidencia (por ejemplo, número de reserva).",
  result_required: "Para completar la tarea escribe el resultado.",
  not_active_member: "Esa persona no es miembro activo de la agencia.",
  last_stage_of_kind: "Debe quedar al menos una etapa activa de cada tipo (abierta, ganada y perdida).",
  stage_inactive: "Esa etapa está desactivada.",
  stage_name_taken: "Ya existe una etapa con ese nombre.",
  whatsapp_blocked: "El contacto retiró el permiso para escribirle por WhatsApp.",
  no_phone: "El contacto no tiene teléfono.",
  phone_unverified: "El teléfono llegó por el formulario web y está sin verificar. Confírmalo en la ficha del contacto para usarlo.",
  email_unverified: "El correo llegó por el formulario web y está sin verificar. Confírmalo en la ficha del contacto para usarlo.",
  reopen_reason_required: "Para reabrir una oportunidad cerrada escribe el motivo.",
  task_locked: "Esta tarea automática no permite ese cambio. Pídeselo a un administrador.",
  personal_templates_off: "El administrador no ha habilitado las plantillas personales.",
  stage_required: "Elige la etapa que dispara la plantilla.",
  no_email: "El contacto no tiene correo.",
  email_blocked: "El contacto retiró el permiso para escribirle por correo.",
  task_contact_mismatch: "Esa oportunidad es de otro contacto. Elige una del mismo contacto o ninguna.",
  invalid_color: "El color debe ir como #RRGGBB, por ejemplo #0F6E6E.",
  logo_too_big: "El logo pesa más de 512 KB. Usa una imagen más liviana.",
  logo_type: "El logo debe ser una imagen PNG, WebP o JPG.",
  channel_closed: "Este formulario no está recibiendo mensajes por ahora. Escríbenos por otro medio.",
  rate_limited: "Recibimos muchos envíos seguidos. Espera unos minutos y vuelve a intentarlo.",
  shortcut_taken: "Ya existe una respuesta guardada con ese atajo. Usa otro.",
  quote_version_locked: "Esta versión ya se envió y no se puede cambiar. Crea una versión nueva para hacer el cambio.",
  invalid_quote_transition: "Ese cambio de estado no es posible para esta versión.",
  quote_no_items: "Agrega al menos un servicio antes de enviar la cotización.",
  exchange_rate_required: "Escribe el tipo de cambio que usaste (por ejemplo 4.000 pesos por dólar).",
  valid_until_required: "Escribe hasta qué fecha es válida la cotización.",
  valid_until_past: "La fecha de validez ya pasó. Elige hoy o una fecha posterior.",
  amount_too_large: "El importe es demasiado grande (máximo 999.999.999.999). Revisa la cantidad, el precio y el tipo de cambio.",
  quote_last_version: "No se puede borrar la única versión de una cotización.",
  quote_draft_exists: "Otra persona acaba de crear la versión nueva de esta cotización. Recarga la página para abrirla.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    /** Dato extra para la interfaz, por ejemplo el contacto que ya existe. */
    public readonly detail?: string,
    /** Campo del formulario que causó el error, por ejemplo "phone.1" (nombre e índice). */
    public readonly field?: string,
  ) {
    super(code);
    this.name = "AppError";
  }
}

/** Un identificador malformado (formulario alterado, URL editada) es "no encontrado", no un error interno. */
export function requireIds(...ids: (string | null | undefined)[]): void {
  for (const id of ids) if (id != null && !isUuid(id)) throw new AppError("not_found");
}

/** Error de validación ligado a un campo, para resaltarlo en el formulario. */
export function fieldError(code: ErrorCode, field: string): AppError {
  return new AppError(code, undefined, field);
}

/** Mensajes más precisos cuando se sabe qué campo falló. */
const FIELD_MESSAGES: Record<string, string> = {
  "invalid_input:fullName": "Escribe el nombre (máximo 160 caracteres).",
  "invalid_input:email": "Ese correo no tiene un formato válido.",
  "invalid_input:language": "El idioma va con 2 letras, por ejemplo es o en.",
  "invalid_input:travelStart": "Revisa la fecha de ida.",
  "invalid_input:travelEnd": "La fecha de regreso no puede ser anterior a la de ida.",
  "invalid_input:travelers": "Los viajeros deben ser un número entre 1 y 999.",
  "invalid_input:title": "Escribe qué hay que hacer (máximo 200 caracteres).",
  "invalid_input:dueAt": "Elige la fecha y hora de vencimiento.",
  "invalid_input:source": "Escribe cómo dio o retiró el permiso el contacto.",
  "invalid_input:reason": "Escribe el motivo.",
  "invalid_input:name": "Escribe un nombre de 1 a 60 caracteres.",
  "invalid_input:templateName": "Escribe un nombre de 1 a 80 caracteres.",
  "invalid_input:delayAmount": "La espera debe ser un número entero: hasta 525600 minutos, 2000 horas hábiles, 500 días hábiles o 730 días.",
  "invalid_input:atTime": "La hora fija solo aplica a días hábiles o calendario y va como 09:00.",
  "invalid_input:message": "El mensaje tiene como máximo 1000 caracteres.",
  "invalid_input:weekdayEnd": "La hora de cierre debe ser posterior a la de apertura.",
  "invalid_input:saturdayEnd": "El sábado necesita apertura y cierre, y el cierre va después.",
  "invalid_input:goal": "La meta de la etapa tiene como máximo 120 caracteres.",
  "invalid_input:body": "Escribe el mensaje (máximo 4000 caracteres).",
  "invalid_input:replyBody": "Escribe el texto de la respuesta (máximo 2000 caracteres).",
  "invalid_input:replyTitle": "Escribe un título de 1 a 80 caracteres.",
  "invalid_input:shortcut": "El atajo va sin espacios: letras, números, guion o guion bajo (máximo 30), por ejemplo saludo.",
  "invalid_input:maxMinutes": "El tiempo máximo va en minutos, de 5 a 1440 (24 horas).",
  "invalid_input:privacyUrl": "El enlace del aviso de privacidad debe empezar por https://",
  "invalid_input:quoteTitle": "Escribe un título de 1 a 160 caracteres, por ejemplo Cartagena, 4 noches.",
  "invalid_input:clientName": "Escribe el nombre del cliente (máximo 160 caracteres).",
  "invalid_input:destination": "El destino tiene como máximo 160 caracteres.",
  "invalid_input:validUntil": "Elige la fecha hasta la que vale la cotización.",
  "invalid_input:exchangeRate": "Escribe el tipo de cambio en pesos por dólar, mayor que cero, por ejemplo 4.000.",
  "invalid_input:saleCurrency": "Elige COP o USD.",
  "invalid_input:includes": "Cada texto de condiciones tiene como máximo 4000 caracteres.",
  "invalid_input:excludes": "Cada texto de condiciones tiene como máximo 4000 caracteres.",
  "invalid_input:paymentTerms": "Cada texto de condiciones tiene como máximo 4000 caracteres.",
  "invalid_input:cancellationPolicy": "Cada texto de condiciones tiene como máximo 4000 caracteres.",
  "invalid_input:items": "La cotización admite hasta 60 servicios.",
  "invalid_input:description": "Escribe qué servicio es (máximo 300 caracteres).",
  "invalid_input:supplier": "El proveedor tiene como máximo 160 caracteres.",
  "invalid_input:quantity": "La cantidad debe ser mayor que cero, hasta 9.999 y con máximo 2 decimales.",
  "invalid_input:unit": "Elige la unidad: persona, noche, habitación o servicio.",
  "invalid_input:unitPrice": "Escribe el precio de venta, por ejemplo 1.250.000 (máximo 4 decimales).",
  "invalid_input:unitCost": "Escribe el coste, por ejemplo 1.000.000 (máximo 4 decimales). Si no tiene coste, escribe 0.",
  "invalid_input:costCurrency": "Elige la moneda del coste: COP o USD.",
  "invalid_input:priceCurrency": "Elige la moneda de la venta: COP o USD.",
  "invalid_input:minMarginPct": "Escribe el margen mínimo en porcentaje, de 0 a 90, por ejemplo 10.",
  "invalid_input:validityDays": "Escribe cuántos días vale una cotización, de 1 a 90, por ejemplo 5.",
  "invalid_input:defaultIncludes": "Cada texto tiene como máximo 4000 caracteres.",
  "invalid_input:defaultExcludes": "Cada texto tiene como máximo 4000 caracteres.",
  "invalid_input:defaultPaymentTerms": "Cada texto tiene como máximo 4000 caracteres.",
  "invalid_input:defaultCancellation": "Cada texto tiene como máximo 4000 caracteres.",
};

export function errorMessage(code: ErrorCode, field?: string): string {
  const base = field?.split(".")[0];
  return (base && FIELD_MESSAGES[`${code}:${base}`]) || ERROR_MESSAGES[code];
}

/** Campo al que pertenece cada error que siempre viene del mismo campo. */
export const CODE_FIELDS: Partial<Record<ErrorCode, string>> = {
  invalid_amount: "budgetAmount",
  lost_reason_required: "lostReason",
  lost_note_required: "lostNote",
  won_evidence_required: "wonEvidence",
  reopen_reason_required: "reason",
  result_required: "result",
  stage_name_taken: "name",
  stage_required: "stageId",
  task_contact_mismatch: "opportunityId",
  logo_too_big: "logo",
  logo_type: "logo",
  shortcut_taken: "shortcut",
  quote_no_items: "items",
  exchange_rate_required: "exchangeRate",
  valid_until_required: "validUntil",
  valid_until_past: "validUntil",
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_MESSAGES;
}

/** Error de PostgreSQL dentro de los envoltorios de Drizzle. */
export function pgError(err: unknown): { code?: string; message?: string; constraint_name?: string } | undefined {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e === "object" && e && "code" in e && typeof (e as { code: unknown }).code === "string" && /^[0-9A-Z]{5}$/.test((e as { code: string }).code)) {
      return e as { code?: string; message?: string; constraint_name?: string };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Las reglas de los triggers lanzan P0001 con un código de negocio como mensaje. */
export function rethrowBusiness(err: unknown): never {
  const pg = pgError(err);
  if (pg?.code === "P0001" && isErrorCode(pg.message)) throw new AppError(pg.message);
  if (pg?.code === "42501") throw new AppError("permission_denied");
  if (pg?.code === "22003") throw new AppError("amount_too_large");
  throw err;
}
