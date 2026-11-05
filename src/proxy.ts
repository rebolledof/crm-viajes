import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

/** Dirección con un "%" mal escrito: Next respondería "Internal Server Error" en inglés (informe del 4 nov 2026). */
export function malformedPathResponse(pathname: string): NextResponse | null {
  try {
    decodeURIComponent(pathname);
    return null;
  } catch {
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Página no encontrada</title></head><body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;padding:16px;background:#f8fafc;color:#0f172a"><main><h1 style="font-size:18px">No encontramos esta página</h1><p style="font-size:14px;color:#334155">La dirección está mal escrita. Revisa el enlace que te compartió la agencia.</p></main></body></html>`;
    return new NextResponse(html, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

/** Refresca la sesión de Supabase en cada petición y protege /app. La autorización real ocurre en servidor y en RLS. */
export async function proxy(request: NextRequest) {
  const malformed = malformedPathResponse(request.nextUrl.pathname);
  if (malformed) return malformed;
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/app")) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
