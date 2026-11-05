# SPEC-004 Cotizador con versiones y PDF

- Estado: Aprobada por Felipe el 5 nov 2026 (tarjeta "Aprobada, empieza"), con las imágenes de `diseno/propuesta-cotizador/`. Felipe pidió avanzar con S04 ("Procede con esa etapa") sin responder las 5 preguntas de la propuesta; se tomaron las recomendaciones (ver "Decisiones tomadas por defecto"). Parte 1 en código (ver plan.md).
- Propietario: Felipe
- Sprint: S04 (fase A MVP piloto), 14 a 27 dic 2026. Tareas del tablero: T-022, T-023, T-024, T-025 y T-026.
- Deriva de: SPEC-000 (alcance 5; RF-09 a RF-12 y RF-14; AC-04 a AC-06), briefing 9.1 a 9.5 (COT-001 y COT-005) y la entrevista con la agencia del 18 oct 2026 ("falta de control en cotización").
- Propuesta para conversar: Claude Doc "Propuesta: cotizador con versiones y PDF". Imágenes: carpeta del proyecto `diseno/propuesta-cotizador/` (fuera del repositorio).

## Problema

Hoy las cotizaciones se arman en documentos u hojas sueltas. No se sabe cuál fue la última que vio el cliente, a qué precio, ni cuánto gana la agencia en cada una; un cambio pisa la versión anterior y nadie revisa el margen antes de enviar.

## Usuarios

- Asesor: arma, envía y versiona las cotizaciones de las oportunidades de su agencia; ve costes y márgenes.
- Administrador: lo mismo, y además mantiene el catálogo, los textos por defecto y el margen mínimo de aviso.
- Lectura: ve las cotizaciones y descarga los PDF, pero no ve costes, utilidad ni margen, y no crea ni cambia nada.

## Alcance incluido

1. **Cotización dentro de una oportunidad.** Botón **"Nueva cotización"** en la ficha de la oportunidad. No hay cotizaciones sin oportunidad. Una oportunidad puede tener varias cotizaciones; cada cotización tiene versiones. La cotización toma del contacto y la oportunidad el nombre del cliente, el destino, las fechas y los viajeros, y el asesor puede ajustarlos.
2. **Número.** Cada cotización recibe un consecutivo por agencia (N.º 0001, 0002…) que no se repite ni se reutiliza.
3. **Ítems.** Cada ítem lleva descripción (obligatoria), proveedor (texto libre o del catálogo), cantidad, unidad (persona, noche, habitación, servicio), coste unitario con su moneda y precio de venta. El asesor puede reordenar y quitar ítems mientras es borrador.
4. **Moneda.** Cada cotización tiene una moneda de venta, COP o USD. Si el coste de un ítem está en la otra moneda, el asesor escribe el tipo de cambio de la cotización (por ejemplo 1 USD = 4.000 COP) y el coste se convierte para el cálculo; el coste original y el tipo de cambio quedan guardados.
5. **Cálculo.** Por ítem y en total: coste, venta, utilidad, margen sobre venta y recargo sobre coste (definiciones del glosario). Decimales exactos; COP sin decimales y USD con 2, con redondeo al medio hacia arriba una sola vez por ítem (cantidad × precio unitario) y el total como suma de los ítems ya redondeados.
6. **Vista interna.** Columnas de coste, utilidad y margen marcadas con un candado y el aviso "solo las ve la agencia". Si un ítem o el total queda por debajo del margen mínimo de la agencia, se muestra un aviso ámbar que no bloquea el envío.
7. **Condiciones.** Vigencia (fecha "válida hasta", por defecto 5 días), incluye, no incluye, forma de pago y política de cancelación. El administrador define textos por defecto que se precargan y el asesor puede editarlos en cada cotización.
8. **Guía en 3 pasos** (estilo A de SPEC-002c): 1 Servicios y precios, 2 Condiciones, 3 Revisar y enviar, con el paso actual resaltado y un panel "Siguiente paso".
9. **Vista previa.** "Ver como el cliente" muestra el PDF tal como saldrá, sin datos internos.
10. **Enviar.** "Revisar y enviar" pide confirmación con el total, los avisos de margen y lo que pasará con la oportunidad. Al confirmar: la versión queda congelada (ítems, precios, condiciones, tipo de cambio, cálculo, marca de la agencia y PDF), se descarga el PDF, la oportunidad pasa a "Propuesta enviada" si estaba en una etapa anterior, se dispara la plantilla de seguimiento de esa etapa (S02b) y queda en la auditoría. El asesor envía el PDF por WhatsApp o correo por su cuenta; el CRM no lo manda.
11. **Versiones.** Una versión enviada no se puede editar de ninguna forma. "Crear versión N" copia cualquier versión anterior como borrador nuevo. Al enviar la versión nueva, la anterior pasa a "Sustituida" y sigue disponible con su PDF. Solo hay un borrador abierto por cotización.
12. **Estados de versión.** Borrador, Enviada, Sustituida, Aceptada, Rechazada y Vencida. Vencida se muestra sola cuando pasa la fecha de vigencia de una enviada sin respuesta.
13. **Ficha de la oportunidad.** Tarjeta "Cotizaciones" con la versión vigente, total, estado, vencimiento y el historial de versiones (quién la envió, cuándo y el total), cada una con "Ver" y "Descargar PDF". Botón "El cliente aceptó esta versión": la marca Aceptada y ofrece marcar la oportunidad como ganada. "El cliente la rechazó" la marca Rechazada.
14. **Mi día.** Aviso de cotizaciones enviadas que vencen en los próximos 2 días sin respuesta.
15. **PDF.** Con el logo y el color principal de la agencia (SPEC-002c), número y versión, fecha, válida hasta, cliente, viaje, servicios con su precio de venta (o solo el total, si el asesor lo elige), total con la moneda escrita, incluye, no incluye, forma de pago y cancelación, y pie con asesor, teléfono, correo y web de la agencia. Nunca muestra coste, proveedor neto, utilidad, margen, tipo de cambio ni notas internas. Se genera una sola vez al enviar y se guarda; cambiar después el logo o los datos de la agencia no cambia los PDF ya enviados.
16. **Catálogo simple** (Configuración › Catálogo, administrador): servicios reutilizables con descripción, proveedor, unidad, coste y venta de referencia y moneda. Al agregarlos a una cotización se copian; cambiar el catálogo después no cambia cotizaciones existentes.
17. **Configuración › Cotizaciones** (administrador): margen mínimo de aviso (por defecto 10 %, de 0 a 90 %), vigencia por defecto y textos por defecto de las condiciones.

## Alcance excluido

Enlace privado para que el cliente vea y acepte en línea (S09), reserva desde la cotización aceptada y abonos (S10), impuestos, comisiones y cargos de pago calculados por el sistema (fase C, con asesor contable), alternativas opcionales dentro de una misma versión, tarifas por temporada, edades y suplementos automáticos, aprobación de un jefe por margen bajo, envío automático por WhatsApp o correo, varias monedas de venta en una misma cotización, plantillas de PDF a elegir.

## Requisitos funcionales

- RF-400: Toda cotización pertenece a una oportunidad de la misma agencia; la agencia sale de la sesión verificada.
- RF-401 (RF-12): Los importes se guardan y calculan con decimales exactos y moneda en cada importe; COP sin decimales y USD con 2, con la regla de redondeo del alcance 5.
- RF-402: Utilidad = venta − coste; margen sobre venta = utilidad ÷ venta; recargo sobre coste = utilidad ÷ coste. Con venta 0 o coste 0, el indicador que dividiría por cero se muestra "—".
- RF-403: Un coste en una moneda distinta de la de venta exige tipo de cambio mayor que cero; sin él, la versión no se puede enviar y el campo se resalta.
- RF-404 (RF-09): Al enviar se congela la versión completa, incluido el PDF y la marca de la agencia de ese momento.
- RF-405 (RF-10): Una versión enviada no cambia nunca, ni desde la pantalla ni llamando directo al servidor o a la base. Un cambio se hace en una versión nueva.
- RF-406 (RF-11): El PDF y la vista previa nunca contienen costes, utilidad, margen, recargo, tipo de cambio ni notas internas. El rol Lectura tampoco los recibe del servidor.
- RF-407: El margen mínimo solo avisa; no impide guardar ni enviar.
- RF-408: Enviar mueve la oportunidad a "Propuesta enviada" si estaba antes en el embudo, y no la retrocede si ya estaba después.
- RF-409 (RF-14): Crear, enviar, crear versión, aceptar y rechazar quedan en la auditoría con actor y fecha.
- RF-410: Solo administrador y asesor crean y envían; solo el administrador cambia el catálogo y la configuración de cotizaciones. Todo se comprueba en el servidor y con RLS.
- RF-411: El número de cotización es consecutivo por agencia y no se repite aunque dos asesores creen cotizaciones a la vez.
- RF-412: Cambiar el catálogo no altera cotizaciones existentes.
- RF-413: Una cotización tiene como máximo un borrador abierto.

## Criterios de aceptación

- AC-400 (RF-401, RF-402, AC-06): Dado un ítem con coste 1.000 COP y venta 1.250 COP, entonces la vista interna muestra utilidad 250 COP, margen sobre venta 20 % y recargo sobre coste 25 %.
- AC-401 (RF-406, AC-05): Dada esa misma cotización, cuando se genera el PDF, entonces su texto contiene 1.250 y no contiene 1.000, 250, 20 % ni 25 %.
- AC-402 (RF-401): Dada una cotización en USD con un ítem de 3 unidades a 10,005 USD, entonces el ítem vale 30,02 USD (3 × 10,005 = 30,015, redondeado una vez al final del ítem); dados dos ítems de 0,10 y 0,20 USD, entonces el total es exactamente 0,30 USD. (Más ejemplos independientes de COT-005 se fijan en plan.md antes de programar.)
- AC-403 (RF-401): Dado un ítem en COP con venta 1.000.000,4, entonces se guarda 1.000.000; con 1.000.000,5, entonces 1.000.001.
- AC-404 (RF-403): Dada una cotización en COP con un hotel de coste USD 600 y tipo de cambio 4.000, entonces el coste del ítem es 2.400.000 COP; sin tipo de cambio, al enviar se rechaza, se resalta el campo con "Escribe el tipo de cambio que usaste (por ejemplo 4.000)" y se conserva todo lo escrito.
- AC-405 (RF-404, RF-405, AC-04): Dada la versión 1 enviada con total 5.600.000 COP, cuando el asesor crea la versión 2, cambia el hotel y la envía con 5.100.000 COP, entonces la versión 1 sigue con 5.600.000 COP, sus ítems y su mismo PDF (mismo contenido byte a byte), y aparece como Sustituida.
- AC-406 (RF-405): Dada una versión enviada, cuando alguien intenta cambiar un precio llamando directo al servidor o a la base, entonces se rechaza y la versión no cambia.
- AC-407 (RF-404): Dada una versión enviada en enero con el logo A, cuando la agencia cambia al logo B, entonces el PDF de enero sigue mostrando el logo A y una versión nueva usa el logo B.
- AC-408 (RF-407): Dado un margen mínimo de 10 % y un ítem con margen 8,3 %, entonces se muestra el aviso ámbar en el ítem, en el resumen y en la confirmación, y el envío se permite.
- AC-409 (RF-408): Dada una oportunidad en "Calificado", cuando se envía su primera cotización, entonces pasa a "Propuesta enviada" y se crea la tarea de seguimiento de esa etapa. Dada una oportunidad en "Negociación", cuando se envía una versión nueva, entonces sigue en "Negociación".
- AC-410 (RF-406, RF-410): Dado un usuario de Lectura, cuando abre una cotización o llama al servidor, entonces ve precios de venta y el PDF pero no recibe coste, utilidad ni margen; cuando intenta crear o enviar, se rechaza.
- AC-411 (RF-400, AC-01): Dado un asesor de la agencia B, cuando pide por URL o al servidor una cotización o un PDF de la agencia A, entonces recibe "no encontrado" sin revelar que existe.
- AC-412 (RF-411): Dados dos asesores que crean una cotización al mismo tiempo, entonces reciben números distintos y consecutivos.
- AC-413 (RF-412): Dado un servicio del catálogo con venta 180.000 usado en una cotización, cuando el administrador lo cambia a 200.000, entonces la cotización sigue con 180.000.
- AC-414 (RF-413): Dada una cotización con un borrador abierto, cuando el asesor pulsa "Crear versión", entonces se le lleva al borrador existente en vez de crear otro.
- AC-415 (RF-409): Dada una versión enviada y luego aceptada por Ana, entonces la auditoría muestra quién la creó, quién la envió y "Ana marcó aceptada", con hora de Colombia.
- AC-416: Dada una versión enviada con vigencia hasta el 23 dic sin respuesta, entonces el 22 dic aparece en Mi día como "vence mañana" y el 24 dic se muestra Vencida.
- AC-417 (usabilidad): Dado un ítem sin descripción, cuando el asesor intenta avanzar, entonces el campo se resalta con "Escribe qué servicio es" y nada de lo escrito se pierde; las pantallas funcionan a 375 px y con teclado.

## Datos (borrador; se detalla en plan.md)

- `quotes`: agency_id, opportunity_id, número, título, moneda de venta, creada por, fechas.
- `quote_versions`: agency_id, quote_id, número de versión, estado, datos del cliente y del viaje, condiciones, totales calculados, marca de la agencia copiada, ruta o contenido del PDF, enviada por y cuándo. Un disparador impide cambiar una versión que no está en Borrador.
- `quote_version_costs`: tipo de cambio y margen mínimo vigente de cada versión; solo administrador y asesor.
- `quote_items`: agency_id, quote_version_id, posición, descripción, proveedor, cantidad, unidad, coste unitario y su moneda, venta unitaria, totales por ítem.
- `catalog_services` y `quote_settings` (margen mínimo, vigencia y textos por defecto).
- Importes en `numeric` con moneda en columna propia; nunca `float`. Todas las tablas con `agency_id`, RLS y pruebas de acceso cruzado. Las columnas de coste no llegan al rol Lectura (vista o función que las excluye).
- PDF: generado en el servidor al enviar; dónde se guarda (base o Supabase Storage) y con qué librería se decide en plan.md.

## Entrega por partes

1. Datos, cálculo y reglas de dinero (T-023), con pruebas unitarias de COT-005.
2. Pantalla de armar la cotización, condiciones y catálogo simple (T-022, T-023).
3. Enviar, versiones inmutables y ficha de la oportunidad (T-024).
4. PDF con la marca de la agencia y prueba de que no muestra datos internos (T-025).
5. Felipe reproduce una cotización real de la agencia (T-026).

## Decisiones tomadas por defecto (cambiables)

Felipe dijo "procede" sin responder las preguntas de la propuesta. Se toma la recomendación de cada una:

1. **PDF desglosado o solo total:** el asesor elige en cada cotización; por defecto, desglosado.
2. **Monedas:** se cotiza en COP o en USD (una por cotización), y un proveedor puede cobrar en la otra moneda con tipo de cambio escrito por el asesor.
3. **Quién ve costes:** administrador y asesores; Lectura no.
4. **Margen mínimo:** aviso, no bloqueo; 10 % por defecto, configurable.
5. **Cotización real (T-026):** sigue pendiente de Felipe; no bloquea la construcción, sí la prueba final del sprint.

## Preguntas para Felipe

1. **Cotizaciones reales.** ¿Puedes conseguir una o dos cotizaciones de la agencia, sin datos del cliente? Sirven para revisar que no falte ningún campo antes de programar.
2. **IVA y cargos.** En el MVP no se calculan impuestos; si la agencia los cobra, el asesor los agrega como un ítem. ¿Le sirve así al piloto?

## Trazabilidad

| Requisito | Criterio | Origen |
| --- | --- | --- |
| RF-400 | AC-411 | SPEC-000 RF-01 |
| RF-401, RF-402, RF-403 | AC-400, AC-402 a AC-404 | RF-12, COT-005, 9.3 |
| RF-404, RF-405 | AC-405 a AC-407 | RF-09, RF-10, COT-001 |
| RF-406 | AC-401, AC-410 | RF-11, 9.2 |
| RF-407 | AC-408 | 9.2 (aviso, sin aprobación) |
| RF-408 | AC-409 | S02 embudo, S02b seguimientos |
| RF-409 | AC-415 | RF-14 |
| RF-410 | AC-410 | AGENTS.md (autorización en servidor) |
| RF-411 a RF-413 | AC-412 a AC-414 | Este documento |
