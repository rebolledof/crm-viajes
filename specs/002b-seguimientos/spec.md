# SPEC-002b Plantillas de seguimiento (tareas automáticas)

- Estado: Aprobada por Felipe el 1 nov 2026 ("procede")
- Propietario: Felipe
- Sprint: S02b (fase A MVP piloto), sobre S02
- Deriva de: pedido de Felipe del 1 nov 2026 y la propuesta "Propuesta: tareas automáticas de seguimiento"

## Problema

En S02 cada tarea se crea a mano. Si el asesor olvida programar la llamada de una consulta nueva, la consulta se enfría: el viajero compara varias agencias y suele quedarse con la que responde primero. La agencia quiere que las tareas típicas de cada momento del embudo aparezcan solas, con fecha y mensaje sugerido.

## Usuarios

- Administrador: define las plantillas de la agencia, el horario laboral, qué puede cambiar el asesor en las tareas automáticas y si los asesores pueden crear plantillas propias.
- Asesor: trabaja las tareas automáticas en "Mi día" y en la ficha; si el administrador lo permite, crea plantillas personales.
- Lectura: ve, no cambia nada.

## Alcance incluido

1. **Plantilla**: nombre, disparador, etapa (si aplica), filtro de motivos de pérdida (si aplica), etapa en la que se detiene (opcional), nivel de edición y activa o no.
2. **Disparadores**: se crea una oportunidad; una oportunidad entra en una etapa concreta; se gana; se pierde (con filtro opcional por motivo).
3. **Pasos**: tipo de tarea (llamada, WhatsApp, correo, reunión, seguimiento, recordatorio, tarea), título, cuándo (minutos, horas hábiles, días hábiles o días calendario después del disparo, con hora fija opcional), prioridad, mensaje sugerido y si el paso está bloqueado.
4. **Horario laboral** de la agencia en hora de Colombia: lunes a viernes y sábado, con hora de inicio y fin; domingo no laboral. Por defecto lunes a viernes 8:00 a 18:00 y sábado 8:00 a 12:00 (supuesto hasta que Felipe confirme el de la agencia piloto). Toda fecha calculada cae dentro del horario.
5. **Creación**: al dispararse, la plantilla crea todos sus pasos como tareas de la oportunidad, asignadas a su responsable (o a quien hizo el cambio si no tiene). Si ya hay una tarea abierta del mismo paso, no la repite.
6. **Cancelación automática**: las tareas abiertas de una plantilla pasan a "cancelada" con el motivo cuando la oportunidad llega a la etapa en que la plantilla se detiene (o a una posterior), cuando se cierra (ganada o perdida) en otra etapa, o cuando sale de la etapa cerrada que la disparó. Nunca se borran.
7. **Cambio de responsable**: las tareas automáticas abiertas del responsable anterior pasan al nuevo.
8. **Nivel de edición** por plantilla, para el asesor (el administrador siempre puede todo):
   - Bloqueada: solo completar con resultado.
   - Ajustable (por defecto): además mover la fecha, cambiar la prioridad y editar el mensaje.
   - Libre: además reasignar y cancelar con motivo.
   Un paso bloqueado manda sobre el nivel de la plantilla. Las tareas creadas a mano se comportan como libres.
9. **Plantillas personales**: interruptor de la agencia, apagado por defecto. Encendido, cada asesor crea plantillas que solo se aplican a las oportunidades de las que es responsable y que solo él y el administrador ven. Se suman a las de la agencia.
10. **Acciones con un clic**: una tarea de WhatsApp abre el botón de S02 con el mensaje de la plantilla; una de correo abre el programa de correo con asunto y texto. Se respetan los consentimientos de S02.
11. **Seis plantillas precargadas** en cada agencia: contacto rápido de una oportunidad nueva, Calificado, Propuesta enviada, Negociación, Ganado y Perdido para reactivar.
12. **Historial**: la ficha muestra cuándo se crearon y cancelaron tareas automáticas y por qué plantilla.

## Alcance excluido

Envío automático de mensajes o correos (fase B), pasos que cuentan desde la fecha del viaje (fase C), festivos, condiciones del tipo "si no contestó", reparto de oportunidades entre asesores (S03), IA.

## Requisitos funcionales

- RF-220: Solo el administrador crea, edita y desactiva plantillas de la agencia, cambia el horario y el interruptor de plantillas personales; también en la base de datos.
- RF-221: Al crear una oportunidad se aplican las plantillas activas con disparador "se crea".
- RF-222: Al mover una oportunidad a una etapa se aplican las plantillas activas con disparador "entra en esa etapa"; al moverla a una etapa ganada o perdida, las de "se gana" o "se pierde" (estas últimas solo si el motivo está en su filtro, cuando lo hay).
- RF-223: La fecha de cada tarea se calcula desde el momento del disparo y cae dentro del horario laboral de la agencia.
- RF-224: Las tareas creadas por una plantilla quedan asignadas al responsable de la oportunidad, ligadas a la plantilla y al paso, con su mensaje y su nivel de edición.
- RF-225: Las tareas automáticas abiertas se cancelan según la regla 6 del alcance, con motivo e historial.
- RF-226: El asesor solo cambia en una tarea automática lo que permite su nivel; lo demás se rechaza en el servidor y en la base de datos.
- RF-227: Con el interruptor apagado, un asesor no puede crear plantillas; encendido, solo crea y edita las suyas, que se aplican solo a sus oportunidades.
- RF-228: Una plantilla personal no es visible para otros asesores.
- RF-229: Cada agencia nueva recibe las seis plantillas precargadas; las agencias existentes también.

## Criterios de aceptación

- AC-220 (RF-220): Dado un asesor, cuando intenta crear o editar una plantilla de la agencia, también llamando directo a la base de datos, entonces se rechaza.
- AC-221 (RF-221, RF-224): Dada la plantilla precargada de oportunidad nueva, cuando un asesor crea una oportunidad, entonces aparecen 4 tareas abiertas asignadas al responsable, la primera de tipo WhatsApp con el mensaje de bienvenida.
- AC-222 (RF-223): Dado un disparo un viernes a las 22:00 y un paso "+1 hora hábil", entonces la tarea vence el sábado a las 9:00; con un paso "+15 minutos", el sábado a las 8:00.
- AC-223 (RF-223): Dado un disparo un sábado a las 11:30 y un paso "+1 hora hábil", entonces vence el lunes a las 8:30.
- AC-224 (RF-225): Dada una oportunidad nueva con sus 4 tareas automáticas, cuando el asesor la pasa a "Contactado", entonces las 4 quedan canceladas con el motivo y el historial lo muestra; una tarea creada a mano sigue abierta.
- AC-225 (RF-222, RF-225): Dada una oportunidad en "Propuesta enviada", cuando se marca ganada, entonces se cancelan las tareas de seguimiento y se crean las de "Ganado".
- AC-226 (RF-222): Dada la plantilla de reactivación con filtro "sin respuesta" y "cambio de planes", cuando una oportunidad se pierde por "precio", entonces no se crea la tarea; por "sin respuesta", sí, a 90 días.
- AC-227 (RF-226): Dada una tarea de una plantilla bloqueada, cuando el asesor intenta mover la fecha o cancelarla, entonces se rechaza; completarla con resultado sí funciona. El administrador sí puede moverla.
- AC-228 (RF-226): Dada una tarea de una plantilla ajustable, cuando el asesor mueve la fecha y edita el mensaje, entonces se acepta; cuando intenta reasignarla o cancelarla, entonces se rechaza.
- AC-229 (RF-227, RF-228): Con el interruptor apagado, un asesor no puede crear una plantilla personal; encendido, la crea, se aplica a sus oportunidades y no a las de otro asesor, y el otro asesor no la ve.
- AC-230 (RF-224): Dada una oportunidad cuyo responsable cambia de Ana a Luis, entonces sus tareas automáticas abiertas pasan a Luis.
- AC-231 (RF-221): Dada una oportunidad que vuelve a "Propuesta enviada" con tareas de ese paso aún abiertas, entonces no se duplican.
- AC-232 (RF-229): Cada agencia nueva tiene las seis plantillas activas; la agencia B no ve las de A.

## Decisiones tomadas por defecto (cambiables)

- Horario: lunes a viernes 8:00 a 18:00, sábado 8:00 a 12:00, sin festivos. Pendiente de confirmar por Felipe.
- Todos los pasos se crean al disparar (no uno a uno al completar el anterior); así "Mi día" muestra lo que viene.
- Las tareas de pasos sin hora fija conservan la hora del disparo cuando cuentan en días.
- Las plantillas no se borran: se desactivan. Los pasos sí se pueden borrar; las tareas ya creadas no cambian.

## Trazabilidad

| Requisito | Criterio |
| --- | --- |
| RF-220 | AC-220 |
| RF-221, RF-224 | AC-221, AC-230, AC-231 |
| RF-222 | AC-225, AC-226 |
| RF-223 | AC-222, AC-223 |
| RF-225 | AC-224, AC-225 |
| RF-226 | AC-227, AC-228 |
| RF-227, RF-228 | AC-229 |
| RF-229 | AC-232 |
