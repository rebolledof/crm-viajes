/** Errores de negocio estables (briefing 15.3). El mensaje es para la persona usuaria. */
export const ERROR_MESSAGES = {
  permission_denied: "No tienes permiso para hacer esto.",
  not_found: "No encontramos lo que buscas.",
  invalid_input: "Revisa los datos del formulario.",
  invitation_invalid: "La invitación no es válida: venció, ya se usó, fue revocada o es para otro correo.",
  slug_taken: "Ya existe una agencia con ese nombre. Prueba con otro.",
  not_authenticated: "Tu sesión terminó. Vuelve a iniciar sesión.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = "AppError";
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_MESSAGES;
}
