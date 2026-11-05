# Plan técnico SPEC-004 (parte 1: datos, cálculo de dinero y reglas de versiones)

## Datos

Una migración nueva y aditiva: `20261109000000_cotizador.sql`. Solo crea tipos, tablas, funciones y triggers; no toca datos existentes.

| Tabla | Contenido | Reglas clave |
| --- | --- | --- |
| `quotes` | cotización de una oportunidad, con su número | número consecutivo por agencia con `app.quote_counters` (insert … on conflict, bloquea la fila del contador); el número que mande el cliente se ignora |
| `quote_versions` | datos del cliente y del viaje, moneda de venta, vigencia, condiciones, mostrar precios por ítem; al enviar: total, marca y logo copiados, quién y cuándo | un solo borrador y una sola aceptada por cotización (índices parciales); el trigger `quote_versions_rules` decide qué cambio vale |
| `quote_version_costs` | tipo de cambio y margen mínimo de cada versión (datos internos) | solo administrador y asesor la leen; el tipo de cambio solo cambia en borrador y al cambiar recalcula los ítems; se borra con su versión |
| `quote_items` | descripción, proveedor, cantidad, unidad, precio y coste unitarios con moneda del coste, referencia al catálogo, totales calculados | el trigger `quote_items_compute` calcula `line_total` y `line_cost` y rechaza cualquier cambio si la versión no es borrador; solo administrador y asesor leen la tabla |
| `catalog_services` | servicios reutilizables con coste y venta de referencia | lo leen administrador y asesor; lo cambia el administrador; se copia a la cotización |
| `quote_settings` | margen mínimo (10 %), vigencia por defecto (5 días) y textos por defecto | sin fila valen los valores por defecto; solo el administrador la escribe |

## Dinero

- Importes unitarios en `numeric(16,4)` (admite 10,005 USD), totales en `numeric(14,2)`, moneda en columna propia. Nunca `float`.
- Regla `half_up_item_v1`, guardada en cada versión: total del ítem = cantidad × unitario, convertido a la moneda de venta y redondeado una sola vez (COP 0 decimales, USD 2, el medio hacia arriba). Total de la versión = suma de ítems redondeados.
- Tipo de cambio: siempre pesos por 1 dólar (`exchange_rate`). Coste en USD y venta en COP multiplica; coste en COP y venta en USD divide.
- El cálculo está dos veces: en `src/domain/quotes.ts` (para la pantalla mientras se escribe) y en `app.quote_line_amount` (lo guardado). Una prueba de integración comprueba que dan lo mismo.

## Estados

- Insertar: siempre borrador, versión = la siguiente.
- Borrador → enviada: exige al menos un ítem, tipo de cambio si algún coste está en otra moneda y vigencia de hoy en adelante (hora de Colombia). Copia el total, el margen mínimo, nombre y colores de la agencia y el logo. Las enviadas anteriores de la misma cotización pasan a sustituida (trigger `quote_versions_after`).
- Enviada → aceptada, rechazada o sustituida. Ningún otro cambio: ni datos, ni ítems, ni borrar, ni siquiera con el usuario dueño de la base (el trigger no depende de RLS).
- "Vencida" no se guarda: se calcula al leer con la fecha de Colombia.
- Pasar a sustituida solo vale si hay otra enviada más reciente de la misma cotización.
- Borrar: un borrador sí (sus ítems y su fila de costes se van con él), salvo que sea la única versión (`quote_last_version`); una enviada nunca (`quote_version_locked`).
- Concurrencia: los triggers de ítems y costes leen la versión `for share`, así un ítem no entra en una versión que se está enviando en otra transacción. Dos "nueva versión" a la vez chocan en el índice de borrador único y la segunda recibe `quote_draft_exists`.
- Importes: cada línea y el total deben ser menores que 1e12; si no, `amount_too_large` en el campo del ítem (también si la base desborda, código 22003).

## Costes ocultos para Lectura

Lectura no puede leer `quote_items`, `catalog_services` ni `quote_version_costs` (RLS). Para ver los ítems usa `app.quote_items_for_client(version)`, que devuelve solo descripción, cantidad, unidad, precio y total. `getQuoteVersion` elige la fuente según el permiso `quotes.costs`. El PDF de la parte 4 usará la misma función.

## Código (parte 1)

- `src/domain/quotes.ts`: lectura de importes, cantidades y tipo de cambio; redondeo; totales por ítem y de la versión; utilidad, margen y recargo; aviso de margen bajo; estado para mostrar y días para vencer; problemas antes de enviar.
- `src/server/quotes.ts`: crear cotización desde la oportunidad, guardar borrador (con error ligado a su campo), crear la versión siguiente desde cualquiera (o volver al borrador abierto), leer una versión según el rol y listar las cotizaciones de una oportunidad.
- Permisos nuevos: `quotes.write` y `quotes.costs` (admin y asesor), `quotes.manage` (admin).
- Auditoría: `quote.created` y `quote.version_created` con frase legible; actividad `cotizacion.creada` en la ficha.

## Pruebas

- Unitarias (`tests/unit/cotizador.test.ts`): AC-400, AC-402, AC-403, AC-404 (cálculo), AC-408, AC-416, AC-417 (validación con campo), redondeo por ítem, conversión en los dos sentidos, permisos y el ejemplo de la propuesta.
- Integración (`tests/integration/cotizador.test.ts`): numeración y AC-412 en paralelo, cálculo de la base igual al dominio, AC-402 y AC-403 en la base, totales enviados por el cliente ignorados, recálculo al cambiar el tipo de cambio, AC-404 y validaciones al enviar, congelado y AC-407, AC-405, AC-406 (también como dueño de la base), transiciones, AC-414, versión 3 desde la 1, ficha, AC-410, AC-411 y AC-413.

## Parte 2: pantallas (5 nov 2026)

- `/app/cotizaciones/[versión]?paso=1|2|3`: el borrador se arma en 3 pasos. Paso 1, servicios y precios: moneda de venta, tipo de cambio (aparece cuando algún coste está en otra moneda), servicios con cantidad, unidad, coste por unidad y su moneda, venta por unidad, subir, bajar, quitar y "Agregar del catálogo". Paso 2: cliente, viaje y condiciones, y la casilla para mostrar o no el precio de cada servicio. Paso 3: "Así la verá el cliente" (sin datos internos), "Solo para la agencia" y "Antes de enviar" con lo que falta y su enlace para corregir.
- Se escribe el precio **por unidad** (como se guarda) y debajo se ve la cuenta del servicio: "4 × 750.000 = 3.000.000 COP" y el coste convertido. Así también se ve cómo se entendió el número (hallazgo B4: "10.005" es diez mil cinco).
- Los totales se calculan en el navegador con `src/domain/quotes.ts` mientras se escribe; al guardar, la base recalcula y lo guardado es lo que vale.
- Cada paso guarda solo lo suyo con `saveDraftPart` (toma lo guardado y reemplaza lo del paso). Cambiar de paso con los botones o el indicador de pasos guarda primero, para no perder lo escrito.
- Un rechazo conserva todo, resalta el campo y dice en qué servicio está ("Servicio 2: escribe qué servicio es…").
- Una versión que no es borrador, o cualquier versión vista por Lectura, se muestra como en el paso 3, con la lista de versiones y "Crear versión N" (o "Abrir el borrador" si ya hay uno).
- Ficha de la oportunidad: tarjeta "Cotizaciones" con "Nueva cotización" y cada cotización con su estado y versión. La tarjeta completa (historial, aceptar y rechazar) llega en la parte 3.
- Administración › Ajustes de cotizaciones (margen mínimo, vigencia y textos por defecto) y Administración › Catálogo de servicios (crear, cambiar y desactivar), solo para el administrador. Auditoría: `catalog.created`, `catalog.updated`, `quote_settings.updated`.
- Enviar todavía no está: el paso 3 lo dice. Llega en la parte 3 junto con el PDF de la parte 4.

## Siguientes partes

2. Pantalla de armar la cotización (3 pasos), condiciones, catálogo y Configuración › Cotizaciones.
3. Enviar desde la pantalla: confirmación, mover la oportunidad a "Propuesta enviada" (RF-408, que dispara el seguimiento de S02b), auditoría del envío, aceptar y rechazar (AC-409, AC-415), tarjeta en la ficha y aviso en Mi día.
4. PDF generado al enviar y guardado con la versión, con la prueba de que no contiene datos internos (AC-401).
