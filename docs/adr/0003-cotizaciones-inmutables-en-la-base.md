# ADR 0003: versiones de cotización inmutables y cálculo de dinero en la base

- Estado: aceptado (5 nov 2026, SPEC-004 parte 1)

## Contexto

La constitución exige que lo enviado se conserve (principio 3) y que las cifras salgan de reglas (principio 4). Una versión enviada no puede cambiar aunque alguien salte la aplicación, y el rol Lectura no debe ver costes ni márgenes.

## Decisión

1. Las reglas de estado viven en triggers de PostgreSQL (`app.quote_versions_rules`, `app.quote_items_compute`): una versión que no está en borrador rechaza cualquier cambio de datos o de ítems, y los estados solo avanzan. Como no dependen de RLS, valen también para el dueño de la base.
2. La base calcula y guarda el total de cada ítem con la regla `half_up_item_v1`, que se guarda en cada versión. Si la regla cambia en el futuro, será una regla nueva con otro nombre y las versiones viejas conservan la suya.
3. El coste va en la misma tabla de ítems, que solo leen administrador y asesor. Lectura y el PDF leen los ítems por `app.quote_items_for_client`, que no devuelve coste.
4. Enviar es cambiar el estado a "enviada"; la base valida y congela (total, margen mínimo, marca y logo). Lo que no es dinero ni inmutabilidad (mover la oportunidad, auditoría del envío, PDF) lo hace la aplicación en la misma transacción.

## Consecuencias

- Corregir una cotización enviada siempre es crear una versión nueva; no hay "editar enviada".
- El cálculo está en TypeScript (pantalla) y en SQL (lo guardado); una prueba de integración comprueba que coinciden.
- Para separar más el coste (por ejemplo, ocultarlo también a algunos asesores) habría que moverlo a otra tabla; hoy no hace falta.
