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
