# SPEC-002 Contactos, oportunidades, tareas y botón de WhatsApp

- Estado: Borrador para revisión de Felipe
- Propietario: Felipe
- Sprint: S02 (fase A MVP piloto)
- Deriva de: SPEC-000 (alcance 2, 3, 4 y 9; RF-03 a RF-08, RF-14) y briefing 6.1, 6.2 y 6.4

## Problema

Hoy un asesor no tiene un sitio único donde ver quién es el cliente, qué viaje quiere, en qué punto está y qué hay que hacer después. Las consultas se pierden porque nadie tiene la próxima acción anotada. Este sprint da a la agencia la ficha del cliente, el embudo de ventas y la lista de pendientes del día; la bandeja de mensajes llega en S03.

## Usuarios

- Asesor: crea y trabaja sus contactos, oportunidades y tareas.
- Administrador: lo mismo que el asesor y además ve todo el equipo y configura motivos de pérdida.
- Lectura: ve, no cambia nada.

## Alcance incluido

1. **Contactos**: nombre, varios teléfonos y correos con uno preferido, idioma, ciudad opcional, etiquetas, responsable, origen y notas internas. Teléfonos normalizados a formato internacional (Colombia por defecto).
2. **Duplicados**: al crear o editar, si el teléfono o el correo ya existe en la agencia se avisa y se ofrece abrir el existente. Los nombres parecidos no se fusionan solos.
3. **Consentimiento** por canal (WhatsApp, correo, teléfono) y finalidad (servicio, promociones): otorgado o retirado, con fecha, origen y quién lo registró. Nunca se borra el historial.
4. **Oportunidades**: contacto, origen, responsable, etapa, destino, producto de interés, fechas o flexibilidad, número de viajeros, presupuesto y moneda, prioridad y observaciones. Lo que no se sabe queda como "Desconocido".
5. **Embudo** con las etapas del briefing: nuevo, pendiente de contacto, contactado, en calificación, calificado, preparando propuesta, propuesta enviada, negociación, ganado y perdido. Las etapas de propuesta muestran el aviso "sin cotización formal en el sistema" hasta S04.
6. **Cierre**: perdido exige motivo (precio, sin disponibilidad, cambio de planes, sin respuesta, competencia, otro con nota). Ganado exige una evidencia escrita (por ejemplo, número de reserva o comprobante externo). Una oportunidad cerrada se puede reabrir con motivo.
7. **Tablero** de oportunidades por etapa, con filtro por responsable, y lista con búsqueda.
8. **Tareas**: tipo (llamada, seguimiento, recordatorio, correo, reunión, tarea), responsable, fecha y hora, prioridad, estado y resultado al completarla. La próxima acción de una oportunidad es su tarea abierta más próxima.
9. **Mi día**: mis tareas vencidas y de hoy, y mis oportunidades abiertas sin próxima acción.
10. **Botón de WhatsApp** en la ficha: abre WhatsApp con el número preferido y un mensaje prellenado editable, y registra la actividad en la ficha.
11. **Historial** de la ficha: creación, cambios de etapa, responsable, tareas y aperturas de WhatsApp, con quién y cuándo.

## Alcance excluido

Bandeja de mensajes y asignación automática (S03), cotizaciones (S04), importación CSV (S05), IA de clasificación y prioridad (fase B), fusión de contactos, organizaciones y empresas, secuencias automáticas de seguimiento, envío real de mensajes de WhatsApp (el botón solo abre la app; quien envía es el asesor).

## Requisitos funcionales

- RF-201: Un usuario solo ve contactos, oportunidades y tareas de la agencia activa de su sesión (RF-01).
- RF-202: Los roles admin y asesor crean y editan; lectura solo consulta, también en el servidor y en la base de datos (RF-03).
- RF-203: Un teléfono se guarda normalizado en formato internacional; uno inválido se rechaza con un mensaje claro.
- RF-204: Dentro de una agencia no puede haber dos contactos con el mismo teléfono normalizado o el mismo correo; al intentarlo se informa cuál es el existente.
- RF-205: Una nueva oportunidad para un contacto existente no modifica sus otras oportunidades (RF-05).
- RF-206: Los campos desconocidos se guardan vacíos y se muestran como "Desconocido"; nada se rellena por inferencia (RF-06).
- RF-207: El presupuesto, si existe, lleva importe con decimales exactos y moneda (COP o USD); no puede haber importe sin moneda.
- RF-208: Pasar a perdido exige motivo de la lista; "otro" exige nota (RF-07).
- RF-209: Pasar a ganado exige evidencia escrita.
- RF-210: Toda oportunidad abierta muestra su próxima acción o la alerta "sin próxima acción" (RF-08).
- RF-211: Completar una tarea exige resultado.
- RF-212: El botón de WhatsApp no se ofrece si el contacto retiró el consentimiento de WhatsApp para servicio; en ese caso se muestra el motivo.
- RF-213: Cada creación, cambio de etapa, cambio de responsable, cierre, reapertura, cambio de consentimiento y apertura de WhatsApp queda en la auditoría (RF-14).
- RF-214: Un asesor puede asignar tareas y oportunidades solo a miembros activos de su agencia.

## Criterios de aceptación

- AC-201 (RF-201): Dado un asesor de la agencia A, cuando pide por URL la ficha de un contacto o una oportunidad de la agencia B, entonces recibe "no encontrado".
- AC-202 (RF-202): Dado un usuario de lectura, cuando intenta cambiar la etapa de una oportunidad (también llamando directamente a la acción del servidor), entonces se rechaza y nada cambia.
- AC-203 (RF-203, RF-204): Dado un contacto con el teléfono 300 000 0000, cuando otro asesor crea un contacto con "+57 300-000-0000", entonces el sistema avisa que ya existe y ofrece abrirlo.
- AC-204 (RF-205): Dado un contacto con una oportunidad a Cartagena, cuando se crea otra a Madrid, entonces el contacto tiene dos oportunidades y la de Cartagena no cambia.
- AC-205 (RF-206): Dada una oportunidad creada solo con contacto y destino, entonces fechas, viajeros y presupuesto aparecen como "Desconocido".
- AC-206 (RF-207): Dado un presupuesto de 4.500.000 sin moneda, cuando se guarda, entonces se rechaza.
- AC-207 (RF-208): Dada una oportunidad abierta, cuando se marca perdida sin motivo, o con "otro" sin nota, entonces se rechaza.
- AC-208 (RF-209): Dada una oportunidad en negociación, cuando se marca ganada sin evidencia, entonces se rechaza.
- AC-209 (RF-210): Dada una oportunidad abierta sin tareas abiertas, entonces aparece en "Mi día" de su responsable con la alerta "sin próxima acción".
- AC-210 (RF-211): Dada una tarea abierta, cuando se completa sin resultado, entonces se rechaza.
- AC-211 (RF-212): Dado un contacto que retiró el consentimiento de WhatsApp para servicio, entonces la ficha no ofrece el botón y explica por qué.
- AC-212 (RF-213): Dado un cambio de etapa de "contactado" a "calificado" hecho por Ana, entonces la auditoría y el historial muestran a Ana, la hora y ambas etapas.
- AC-213 (RF-214): Dado un asesor de la agencia A, cuando asigna una tarea a un usuario que no es miembro activo de A, entonces se rechaza.

## Decisiones tomadas por defecto (cambiables)

- Las etapas del embudo son fijas en S02; renombrarlas o agregar etapas por agencia queda para cuando la agencia lo pida.
- Los motivos de pérdida son los seis del briefing; el administrador podrá editarlos más adelante.
- Teléfono por defecto de Colombia (+57) cuando no se escribe el indicativo.
- El mensaje prellenado de WhatsApp es "Hola {nombre}, te escribo de {agencia} por tu viaje a {destino}." y el asesor lo puede editar antes de abrir.
- Al crear un contacto, el consentimiento queda "sin registrar" (no se presume otorgado); el botón de WhatsApp sí se ofrece porque es una respuesta a una consulta del propio cliente.

## Preguntas para Felipe

- ¿Los nombres de las etapas te sirven tal cual o la agencia usa otros?
- ¿Qué cuenta como evidencia de "ganado" para la agencia: número de reserva del proveedor, comprobante de pago, otra cosa?

## Trazabilidad

| Requisito | Criterio | SPEC-000 / briefing |
| --- | --- | --- |
| RF-201 | AC-201 | RF-01 |
| RF-202 | AC-202 | RF-03 |
| RF-203, RF-204 | AC-203 | 6.1 |
| RF-205 | AC-204 | RF-05, CRM-002 |
| RF-206 | AC-205 | RF-06 |
| RF-207 | AC-206 | RF-12 |
| RF-208 | AC-207 | RF-07, 6.2 |
| RF-209 | AC-208 | 6.2 |
| RF-210 | AC-209 | RF-08 |
| RF-211 | AC-210 | 6.4 |
| RF-212 | AC-211 | CRM-006 |
| RF-213 | AC-212 | RF-14 |
| RF-214 | AC-213 | 5.3 |
