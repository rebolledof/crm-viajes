# ADR 0004: PDF de la cotización generado en el servidor y guardado en la base

- Estado: aceptado (7 nov 2026, SPEC-004 parte 4)

## Contexto

SPEC-004 pide que el PDF se genere una sola vez al enviar y no cambie nunca (RF-404, AC-405, AC-407), y que no tenga datos internos (RF-406). La app corre en Vercel (funciones sin navegador) y la base es PostgreSQL de Supabase.

## Decisión

1. El PDF se dibuja con `pdf-lib` (JavaScript puro, sin binarios ni navegador) en `src/server/quote-pdf.ts`, con las fuentes estándar Helvetica. Recibe solo datos para el cliente: los ítems salen de `app.quote_items_for_client`, sin coste ni proveedor.
2. Se guarda en la tabla `quote_pdfs` (bytea, máximo 5 MB, con su huella SHA-256) en la misma transacción del envío. Un trigger impide cambiarlo o borrarlo, incluso al dueño de la base, y solo deja guardarlo para una versión ya enviada.
3. Las fechas del documento son la de envío, así que los mismos datos dan los mismos bytes. Una versión enviada antes de esta parte se genera al descargarla, con sus datos congelados, y se guarda la primera vez que la descarga un administrador o asesor.
4. El borrador tiene una vista previa marcada "BORRADOR" que no se guarda.

## Consecuencias

- Sin Storage de Supabase ni servicios externos: el PDF vive con la versión y lo protege la misma RLS.
- Las fuentes estándar solo tienen el alfabeto WinAnsi (español completo); un emoji u otro símbolo sale como "?". Un logo en WebP no se puede incrustar: va el nombre de la agencia. Si hiciera falta, se puede incrustar una fuente TTF o convertir el logo al subirlo.
- La base crece unos 2 a 10 KB por versión enviada sin logo, más el tamaño del logo; está bien para el piloto.
