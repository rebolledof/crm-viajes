// Informe de pruebas del 4 nov 2026: una dirección con un "%" mal escrito (por ejemplo /c/%ZZ)
// respondía "Internal Server Error" en inglés. Ahora responde en español, sin marca de agencia.
// También: errores inesperados en español y mensajes largos que no se cortan en el celular.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { malformedPathResponse, proxy } from "@/proxy";

describe("dirección mal escrita", () => {
  it("un % mal escrito responde 400 con el aviso en español", async () => {
    const r = malformedPathResponse("/c/%ZZ");
    expect(r?.status).toBe(400);
    const html = await r!.text();
    expect(html).toContain("No encontramos esta página");
    expect(html).toContain('lang="es"');
    expect(html).not.toMatch(/Internal Server Error|Not Found/);
  });

  it("otros % mal escritos, también en el formulario, responden igual", () => {
    for (const p of ["/c/%", "/c/%%", "/c/%C3", "/f/%ZZ", "/f/%"]) expect(malformedPathResponse(p)?.status).toBe(400);
  });

  it("el proxy responde antes de llamar a Supabase", async () => {
    const r = await proxy(new NextRequest("http://crm.test/c/%ZZ"));
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("No encontramos esta página");
  });

  it("una dirección normal sigue su camino", () => {
    expect(malformedPathResponse("/c/0123456789abcdef0123456789abcdef")).toBeNull();
    expect(malformedPathResponse("/c/caf%C3%A9")).toBeNull();
  });
});

describe("error inesperado (informe del 4 nov 2026)", () => {
  it("la página de error y la de error global hablan en español y ofrecen reintentar", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const ErrorPage = (await import("@/app/error")).default;
    const GlobalError = (await import("@/app/global-error")).default;
    const props = { error: new Error("x"), retry: () => {} };
    for (const html of [renderToStaticMarkup(createElement(ErrorPage, props)), renderToStaticMarkup(createElement(GlobalError, props))]) {
      expect(html).toContain("Algo salió mal");
      expect(html).toContain("Intentar de nuevo");
      expect(html).not.toMatch(/Something went wrong|Application error/);
    }
  });
});

describe("mensajes largos en el celular (prueba a 375 px, 4 nov 2026)", () => {
  it("una palabra muy larga se parte en la burbuja del chat y en la bandeja", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const f of ["src/app/c/[key]/chat-window.tsx", "src/app/app/bandeja/page.tsx", "src/app/app/bandeja/respuestas/page.tsx"]) {
      expect(await readFile(f, "utf8")).toMatch(/whitespace-pre-wrap \[overflow-wrap:anywhere\]/);
    }
  });
});
