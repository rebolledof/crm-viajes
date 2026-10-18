# SPEC-000 MVP piloto

- Estado: Borrador (pendiente de la entrevista con la agencia)
- Propietario: Felipe
- Fase: A, sprints S01 a S05

## Problema

La agencia pierde consultas y contexto entre asesores, y arma cotizaciones en documentos sueltos sin versión ni vínculo con el cliente.

## Usuarios

Administrador de la agencia, asesor comercial y usuario de solo lectura.

## Alcance incluido

1. Login, agencia, invitaciones con caducidad y roles admin, asesor y lectura.
2. Contactos con varios teléfonos y correos, consentimiento por canal y detección de duplicados por teléfono o correo.
3. Oportunidades con campos mínimos, embudo configurable, motivos de pérdida y responsable.
4. Tareas con responsable, fecha, prioridad y resultado; vista "mi día".
5. Cotizador: catálogo simple de servicios, ítems con coste y precio en moneda propia, totales con decimales exactos, margen interno, versiones inmutables al enviar y PDF con la marca de la agencia.
6. Formulario web embebible que crea un lead.
7. Importación CSV de contactos con previsualización, errores e idempotencia.
8. Botón de WhatsApp que abre el chat con un mensaje prellenado y registra la actividad.
9. Auditoría, exportación CSV y copia de seguridad restaurable.

## Alcance excluido

API oficial de WhatsApp, bandeja de mensajes, IA, bot, aceptación online, reservas, pagos, planes del SaaS, gestor web y circuitos.

## Requisitos funcionales

- RF-01: Un usuario solo ve y modifica registros de la agencia activa de su sesión.
- RF-02: Una invitación caducada o revocada no da acceso.
- RF-03: Un asesor ve y edita las oportunidades de su agencia según su rol; lectura no modifica nada.
- RF-04: Una consulta crea un contacto (o reutiliza uno existente con el mismo teléfono o correo) y una oportunidad, con origen y fecha.
- RF-05: Una segunda consulta del mismo contacto sobre otro viaje crea otra oportunidad sin sobrescribir la anterior.
- RF-06: Los campos desconocidos se guardan como desconocidos, sin inferencias.
- RF-07: Marcar perdida exige motivo.
- RF-08: Toda oportunidad abierta muestra su próxima acción o una alerta de que no tiene.
- RF-09: Al enviar una cotización se congela su versión: ítems, precios, condiciones, cálculo y PDF.
- RF-10: Editar una cotización enviada crea una nueva versión; la anterior no cambia.
- RF-11: El PDF y cualquier vista para el cliente nunca muestran costes ni margen.
- RF-12: Los importes se calculan con decimales exactos y redondeo definido por moneda (COP sin decimales, USD con 2).
- RF-13: Reimportar el mismo CSV no duplica contactos.
- RF-14: Cada creación, cambio de estado, envío de cotización, importación y cambio de rol queda en la auditoría.

## Criterios de aceptación

- AC-01 (RF-01): Dado un asesor de la agencia A, cuando pide por URL o API una oportunidad de la agencia B, entonces recibe "no encontrado" y no se revela que existe.
- AC-02 (RF-04, RF-05): Dado un contacto con el teléfono +57 300 000 0000, cuando llega un formulario con ese teléfono para otro destino, entonces se crea una segunda oportunidad vinculada al mismo contacto.
- AC-03 (RF-07): Dada una oportunidad abierta, cuando el asesor la marca perdida sin motivo, entonces el sistema lo rechaza.
- AC-04 (RF-09, RF-10): Dada una cotización enviada en su versión 1, cuando el asesor cambia un precio y la reenvía, entonces existe la versión 2 y el PDF y totales de la versión 1 siguen iguales.
- AC-05 (RF-11): Dada una cotización con coste 1.000 y venta 1.250, cuando se genera el PDF, entonces muestra 1.250 y no muestra 1.000, 250, 20 % ni 25 %.
- AC-06 (RF-12): Dado coste 1.000 y venta 1.250, entonces la vista interna muestra utilidad 250, margen sobre venta 20 % y recargo sobre coste 25 %.
- AC-07 (RF-13): Dado un CSV de 10 filas ya importado, cuando se importa otra vez, entonces el informe dice 0 nuevas y 10 existentes.
- AC-08 (RF-02): Dada una invitación con 7 días de vigencia, cuando se usa el día 8, entonces se rechaza.

## Preguntas pendientes

- ¿Qué le duele más a la agencia hoy? Puede cambiar el orden de S02 a S04.
- Marca y dominio del producto.
- Política de tratamiento de datos antes de cargar datos reales (bloqueante para S05).

## Trazabilidad

| Requisito | Criterio | Briefing |
| --- | --- | --- |
| RF-01 | AC-01 | 5.3, 14.3 |
| RF-04, RF-05 | AC-02 | CRM-001, CRM-002 |
| RF-07 | AC-03 | 6.2 |
| RF-09, RF-10 | AC-04 | COT-001 |
| RF-11, RF-12 | AC-05, AC-06 | 9.3, COT-005 |
| RF-13 | AC-07 | CRM-007 |
| RF-02 | AC-08 | 5.3 |
