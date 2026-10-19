/** Errores de negocio estables (briefing 15.3). El mensaje es para la persona usuaria. */
export const ERROR_MESSAGES = {
  permission_denied: "No tienes permiso para hacer esto.",
  not_found: "No encontramos lo que buscas.",
  invalid_input: "Revisa los datos del formulario.",
  invitation_invalid: "La invitación no es válida: venció, ya se usó, fue revocada o es para otro correo.",
  slug_taken: "Ya existe una agencia con ese nombre. Prueba con otro.",
  not_authenticated: "Tu sesión terminó. Vuelve a iniciar sesión.",
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
  reopen_reason_required: "Para reabrir una oportunidad cerrada escribe el motivo.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    /** Dato extra para la interfaz, por ejemplo el contacto que ya existe. */
    public readonly detail?: string,
  ) {
    super(code);
    this.name = "AppError";
  }
}

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
  throw err;
}
