// Traduce los códigos de error de Supabase Auth al motivo que la pantalla de registro muestra.
export type SignUpProblem = "limite_correos" | "clave_debil" | "ya_existe" | "correo_invalido" | "registro";

export function signUpProblem(code: string | undefined, status?: number): SignUpProblem {
  switch (code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "limite_correos";
    case "weak_password":
      return "clave_debil";
    case "user_already_exists":
    case "email_exists":
      return "ya_existe";
    case "email_address_invalid":
      return "correo_invalido";
  }
  return status === 429 ? "limite_correos" : "registro";
}

/** Motivos que muestran las pantallas de acceso; también llegan por ?error= desde otras rutas. */
export const AUTH_MESSAGES: Record<string, string> = {
  datos: "Escribe un correo válido y una contraseña de 8 a 72 caracteres.",
  credenciales: "El correo o la contraseña no coinciden.",
  sin_confirmar: "Todavía no confirmaste tu correo. Abre el enlace que te enviamos al registrarte.",
  enlace: "El enlace venció o ya se usó. Pide uno nuevo en \"Olvidé mi contraseña\".",
  registro: "No se pudo crear la cuenta. Intenta de nuevo en unos minutos; si sigue, avísanos.",
  limite_correos: "Se enviaron demasiados correos en poco tiempo. Espera una hora y vuelve a intentarlo.",
  clave_debil: "La contraseña es muy fácil de adivinar. Usa una más larga, con letras y números.",
  ya_existe: "Ya hay una cuenta con ese correo. Inicia sesión.",
  correo_invalido: "Ese correo no es válido para crear una cuenta.",
  distintas: "Las dos contraseñas no coinciden.",
  igual: "La contraseña nueva debe ser distinta de la anterior.",
  cambio: "No se pudo cambiar la contraseña. Pide un enlace nuevo e inténtalo otra vez.",
};
