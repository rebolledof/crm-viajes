# SPEC-003 Bandeja unificada: formulario, chat web y correo

- Estado: Aprobada por Felipe el 2 nov 2026 ("procede"). Las 3 preguntas quedaron con la recomendación (correo simulado por ahora, enlace configurable al aviso de privacidad, 30 minutos en horario laboral); Felipe puede cambiarlas. Parte 1 implementada (ver plan.md).
- Propietario: Felipe
- Sprint: S03 (fase A MVP piloto), sobre S02, S02b y el diseño de SPEC-002c
- Deriva de: SPEC-000 (alcance 6, 7 y 8; RF-15 a RF-18; AC-09 a AC-11) y la entrevista con la agencia del 18 oct 2026: contactos por varias fuentes, poco control de las respuestas, no saber si se responde a todos y tiempo perdido respondiendo lo que ya está en la web.
- Imagen de la propuesta: carpeta del proyecto `diseno/propuesta-bandeja/`.

## Problema

Hoy las consultas llegan por la web, por correo y por WhatsApp, cada una a un lugar distinto. Nadie sabe si a un cliente ya le respondieron, quién lo atiende ni cuánto lleva esperando. El viajero suele quedarse con la agencia que responde primero, así que un mensaje olvidado es una venta perdida. Además, los asesores escriben una y otra vez las mismas respuestas.

## Usuarios

- Visitante de la web de la agencia: escribe por el formulario o por el chat.
- Asesor: atiende sus conversaciones y toma las de la cola sin asignar.
- Administrador (supervisor): ve todas, reparte, recibe la alerta de las que llevan mucho sin respuesta, configura los canales, el tiempo máximo y las respuestas guardadas.
- Lectura: ve la bandeja, no responde ni cambia nada.

## Alcance incluido

1. **Bandeja** (`/app/bandeja`), una sola lista con las conversaciones de los tres canales. Filtros: **Sin responder**, **Mías**, **Sin asignar**, **Todas** y **Resueltas**; búsqueda por nombre, teléfono o correo. Cada fila muestra el canal, el contacto, el inicio del último mensaje, el responsable, el estado y cuánto lleva esperando.
2. **Conversación**: hilo de mensajes en orden, con canal, autor y hora (hora de Colombia). Caja de respuesta con botón de respuestas guardadas. Panel lateral con el contacto, su oportunidad y la tarjeta **"Qué hacer ahora"**.
3. **Estados**: **Abierta** (el último mensaje es del cliente), **Pendiente** (le respondimos y esperamos al cliente) y **Resuelta** (cerrada a mano). Un mensaje nuevo del cliente reabre una conversación pendiente o resuelta.
4. **Responsable**: si el contacto ya tiene una oportunidad abierta, la conversación va a su responsable; si no, queda en la cola **Sin asignar** y cualquier asesor la toma con **"Tomar"**. El administrador puede reasignar. Cada cambio queda en el historial.
5. **Contacto y oportunidad**: cada mensaje entrante se vincula a un contacto existente con el mismo teléfono o correo, o crea uno nuevo (reglas de duplicados de S02). El formulario crea además una oportunidad con origen "Formulario web" (lo que dispara las plantillas de seguimiento de S02b). En chat y correo, que también traen mensajes que no son ventas (proveedores, clientes con viaje en curso), la tarjeta "Qué hacer ahora" ofrece **"Crear oportunidad"** o **"Vincular a una oportunidad"** con un clic.
6. **Formulario web**: página pública de la agencia con su marca (`/f/<código del formulario>`, un código aleatorio de 32 caracteres; no se usa el nombre de la agencia para que no se pueda adivinar), con nombre, teléfono, correo, destino, fechas aproximadas, número de viajeros, mensaje y aceptación del aviso de privacidad. Se enlaza desde la web de la agencia o se incrusta con un código que se copia desde Configuración. Al enviarlo, el visitante ve una confirmación.
7. **Chat web**: burbuja que la agencia pega en su web con una línea de código. El visitante deja nombre y teléfono o correo y acepta el aviso de privacidad antes del primer mensaje; ve las respuestas del asesor en la misma ventana y puede volver más tarde en el mismo navegador. Fuera del horario laboral, la burbuja avisa que la respuesta llegará en el siguiente horario.
8. **Correo entrante**: la agencia reenvía automáticamente su buzón de ventas (por ejemplo `ventas@agencia.com`) a una dirección única que le da el CRM. Cada correo entra una sola vez (se reconoce por su identificador de mensaje) y las respuestas del mismo hilo se agrupan en la misma conversación. Se muestra el texto; los adjuntos se listan por nombre con el aviso "revísalos en tu correo".
9. **Responder**: por el mismo canal por el que escribió el cliente. Chat: aparece en la burbuja. Correo: sale un correo desde la dirección de la agencia en el mismo hilo. Formulario: se responde por correo si dejó uno; si solo dejó teléfono, el botón de WhatsApp de S02 con el texto escrito (se registra como enviado al abrirlo, igual que en S02). Cada respuesta registra quién la envió y cuándo.
10. **Sin responder**: una conversación abierta cuyo último mensaje del cliente supera el tiempo máximo de la agencia (por defecto 30 minutos, configurable de 5 a 1440) queda marcada **"Sin responder"** en rojo. El tiempo cuenta solo dentro del horario laboral de S02b. Alertas: número en rojo junto a "Bandeja" en el menú para todos; para el administrador, una franja arriba de Mi día y de la Bandeja con "N conversaciones del equipo sin responder" y quién las tiene. No hay notificaciones por correo ni al celular en esta etapa.
11. **Respuestas guardadas**: título, atajo (por ejemplo `/precios`) y texto con campos `{nombre}`, `{asesor}` y `{agencia}` que se reemplazan al insertar. Las de la agencia las crea el administrador; cada asesor puede tener las suyas, que solo él ve. Se insertan con el botón o escribiendo `/` en la caja; el texto insertado se puede editar antes de enviar. Se precargan 5 de ejemplo (saludo, pedir fechas y viajeros, formas de pago, documentos para viajar, fuera de horario).
12. **Guía paso a paso** (estilo A de SPEC-002c):
    - Cada fila de la bandeja dice su siguiente paso: **Tomar**, **Responder**, **Esperando al cliente** o **Crear oportunidad**.
    - En la conversación, "Qué hacer ahora" muestra 3 pasos en orden con flechas: 1 Responde, 2 Vincula o crea la oportunidad, 3 Programa el siguiente paso (la tarea de S02). El paso actual va resaltado.
    - Mi día suma un primer paso al plan: **"Responde los mensajes"**, con el número de conversaciones sin responder del asesor; queda hecho cuando llega a cero.
    - Al marcar una conversación como resuelta sin oportunidad ni tarea, se pregunta "¿Era una consulta de viaje?" (se puede omitir).
13. **Configuración › Canales** (solo administrador): activar o pausar el formulario y el chat, copiar sus códigos, ver la dirección de reenvío del correo con el paso a paso para configurarlo en Gmail u Outlook, enlace al aviso de privacidad de la agencia y tiempo máximo sin respuesta. **Configuración › Respuestas guardadas**.
14. **Protección contra abuso**: campo trampa invisible y límite de envíos por dirección y por agencia en formulario y chat; tamaño máximo de mensaje (4.000 letras); el canal pausado rechaza mensajes nuevos.

## Alcance excluido

WhatsApp, Instagram y Messenger por API (fase B, cuando Meta apruebe), bot o IA que responda (S07 en adelante), reparto automático por turnos, notificaciones por correo o al celular, adjuntos (ni enviarlos ni guardarlos), plantillas de correo con diseño, firmas por asesor, varios buzones por agencia, encuestas de satisfacción, métricas de tiempo de respuesta (se pueden calcular después con los datos guardados).

## Requisitos funcionales

- RF-260 (RF-15): Un mensaje entrante por formulario, chat o correo queda una sola vez en la bandeja, vinculado a un contacto y a una conversación, con canal y fecha.
- RF-261 (RF-04): El formulario crea o reutiliza el contacto por teléfono o correo y crea una oportunidad con origen "Formulario web"; una segunda consulta del mismo contacto crea otra oportunidad.
- RF-262: La agencia de un mensaje público sale del canal (identificador del formulario, del chat o de la dirección de reenvío), nunca de un campo que mande el visitante. Un canal pausado o inexistente rechaza el mensaje.
- RF-263 (RF-16): Cada conversación tiene un responsable o está en la cola sin asignar. Tomar, reasignar y resolver queda en el historial.
- RF-264: El estado cambia solo según la regla 3 del alcance.
- RF-265 (RF-17): Una conversación abierta cuyo último mensaje del cliente supera el tiempo máximo, contado en horario laboral, aparece como sin responder; el administrador ve la alerta del equipo.
- RF-266 (RF-18): Cada respuesta registra quién la envió, cuándo y por qué canal, y sale por el canal de la regla 9.
- RF-267: Un asesor ve y responde las conversaciones de su agencia; Lectura no puede responder, tomar ni resolver. Todo se comprueba en el servidor y con RLS.
- RF-268: Solo el administrador cambia los canales, el tiempo máximo y las respuestas guardadas de la agencia; un asesor solo crea y edita las suyas.
- RF-269: Los campos de una respuesta guardada se reemplazan al insertar y el texto se puede editar antes de enviar.
- RF-270: El visitante del chat solo ve los mensajes de su propia conversación.
- RF-271: El formulario y el chat exigen aceptar el aviso de privacidad, y el consentimiento queda registrado en el contacto (consentimientos de S02) con canal y fecha.

## Criterios de aceptación

- AC-260 (RF-260, AC-09): Dado el mismo correo entrante recibido dos veces, entonces la bandeja muestra un solo mensaje.
- AC-261 (RF-261, AC-02): Dado un contacto con el teléfono +57 300 000 0000, cuando llega un formulario con ese teléfono para otro destino, entonces se crea una segunda oportunidad del mismo contacto y una conversación con el mensaje, y se crean las tareas de la plantilla "oportunidad nueva".
- AC-262 (RF-262): Dado un formulario de la agencia A, cuando el visitante agrega a mano el identificador de la agencia B, entonces el mensaje entra solo en A; con el formulario pausado, se rechaza con un aviso amable.
- AC-263 (RF-263): Dado un contacto sin oportunidad abierta, cuando escribe por el chat, entonces la conversación aparece en "Sin asignar"; cuando Ana pulsa "Tomar", pasa a "Mías" de Ana y el historial lo muestra.
- AC-264 (RF-263): Dado un contacto con una oportunidad abierta de Luis, cuando escribe por correo, entonces la conversación queda asignada a Luis.
- AC-265 (RF-264): Dada una conversación abierta, cuando Ana responde, entonces pasa a pendiente; cuando el cliente vuelve a escribir, entonces vuelve a abierta; una resuelta también se reabre.
- AC-266 (RF-265, AC-10): Dado un tiempo máximo de 30 minutos, cuando un cliente escribe un martes a las 10:00 y nadie responde, entonces a las 10:31 la conversación aparece como sin responder, el menú muestra el número y el administrador ve la franja de alerta.
- AC-267 (RF-265): Dado un tiempo máximo de 30 minutos, cuando un cliente escribe un viernes a las 22:00, entonces no aparece como sin responder hasta el sábado a las 8:31.
- AC-268 (RF-266, AC-11): Dada una respuesta de Ana, entonces el historial muestra "Ana", la hora del envío y el canal; en el chat el visitante la ve en su ventana.
- AC-269 (RF-267): Dado un usuario de Lectura, cuando intenta responder, tomar o resolver, también llamando directo al servidor o a la base, entonces se rechaza. Dado un asesor de la agencia B, entonces no ve ninguna conversación de A.
- AC-270 (RF-268): Dado un asesor, cuando intenta cambiar el tiempo máximo o una respuesta guardada de la agencia, entonces se rechaza; su respuesta personal no la ve otro asesor.
- AC-271 (RF-269): Dada la respuesta guardada "Hola {nombre}, soy {asesor} de {agencia}", cuando Ana la inserta en la conversación con María, entonces la caja dice "Hola María, soy Ana de Andes Travel" y Ana puede editarla antes de enviar.
- AC-272 (RF-270): Dados dos visitantes del chat, cuando uno pide los mensajes con el identificador de la conversación del otro, entonces no recibe nada.
- AC-273 (RF-271): Dado un formulario sin aceptar el aviso de privacidad, entonces no se envía y lo escrito no se borra; aceptado, el contacto queda con el consentimiento, el canal y la fecha.
- AC-274 (alcance 14): Dado un formulario con el campo trampa lleno o 20 envíos en un minuto desde la misma dirección, entonces no se crean conversaciones nuevas.
- AC-275 (alcance 12): Dadas 2 conversaciones sin responder de Ana, cuando abre Mi día, entonces el primer paso del plan es "Responde los mensajes (2)"; al responderlas, queda hecho.
- AC-276 (D-14): Dado un contacto existente con teléfono, cuando llega un formulario con ese teléfono y un correo nuevo, entonces el correo queda "sin verificar", no es el preferido y no se usa para responder ni en tareas hasta que un asesor o administrador lo confirma en la ficha (Lectura no puede); guardar la ficha no lo confirma. Un contacto nuevo del formulario queda con sus datos verificados.

## Datos (borrador; se detalla en plan.md)

- `inbound_channels` (por agencia): tipo (`form`, `chat`, `email`), identificador público aleatorio, activo o pausado.
- `conversations`: `agency_id`, contacto, oportunidad (opcional), canal, responsable (opcional), estado, fecha del último mensaje del cliente y nuestro, asunto (correo).
- `messages`: `agency_id`, conversación, dirección (entrante o saliente), autor (usuario o visitante), texto, identificador externo único por agencia (para no duplicar correos), fecha.
- `saved_replies`: `agency_id`, dueño (vacío si es de la agencia), título, atajo, texto.
- `agency_settings.max_unanswered_minutes` (por defecto 30).
- Toda tabla lleva `agency_id` y RLS. Los mensajes públicos entran por funciones de la base con permisos acotados que solo aceptan un canal válido; el webhook del correo además valida la firma del proveedor. La aplicación no usa la clave de servicio.
- Migración solo aditiva.

## Entrega por partes (para revisar en pedazos chicos)

1. **Bandeja + formulario + respuestas guardadas + alertas** (T-027 parte formulario, T-029, T-030, T-031). Ya sirve en el piloto aunque falten los otros dos canales.
2. **Chat web** (T-027 parte chat).
3. **Correo entrante y respuesta por correo** (T-028), cuando esté decidida la pregunta 1.

Cada parte va en su PR, con prueba independiente con otro modelo antes del merge.

## Decisiones tomadas por defecto (cambiables)

- El reloj de "sin responder" cuenta solo en horario laboral (si no, cada mensaje de la noche sería alerta al abrir).
- Reparto: cola "Sin asignar" con botón "Tomar"; sin reparto automático por turnos.
- La burbuja del chat consulta respuestas nuevas cada pocos segundos mientras está abierta, en lugar de una conexión en tiempo real (más simple y dentro del plan gratuito).
- El formulario crea oportunidad; el chat y el correo no, hasta que el asesor lo decida.
- Mensajes guardados como texto simple, sin formato.
- Mientras nadie toma una conversación del formulario, las tareas automáticas de su oportunidad quedan con el administrador activo más antiguo (la base necesita un responsable para cada tarea); al tomarla, pasan a quien la tomó. Decisión del 2 nov 2026 al implementar (ADR 0002).
- En la parte 1 el formulario se responde por WhatsApp o por correo desde la app del asesor (el CRM registra la respuesta y abre la app con el texto). La salida directa por correo llega con la parte 3.
- Al responder una conversación sin responsable, quien responde la toma.
- Límite de envíos públicos: 5 cada 10 minutos por dirección y formulario, y 200 cada 10 minutos por agencia. La dirección no se guarda: solo su huella.
- Cambiar el tiempo máximo aplica a los mensajes que lleguen desde ese momento.
- D-14 (Felipe, 2 nov 2026): el teléfono o correo que llega por el formulario a un contacto que ya existía queda "sin verificar" hasta que un asesor lo confirma, porque lo pudo escribir otra persona.
- D-15 (Felipe, 2 nov 2026): cualquier asesor puede resolver una conversación, también la de otro; se reabre sola si el cliente vuelve a escribir.
- La pregunta "¿Era una consulta de viaje?" al resolver y el botón "Vincular a una oportunidad" llegan con el chat y el correo (partes 2 y 3): en la parte 1 toda conversación del formulario ya tiene oportunidad.

## Preguntas para Felipe

1. **Correo (bloquea solo la parte 3).** Para recibir y enviar correos hace falta un servicio de correo. Recomendación: crear una cuenta en **Resend** (plan gratuito, unos 3.000 correos al mes) y usarla también como el correo propio de Supabase que ya está pendiente antes del piloto. Para que las respuestas salgan desde `ventas@agencia.com` sin caer en spam, la agencia debe agregar unos registros en su dominio (los preparamos y se los pasamos). ¿Te parece, o prefieres otro servicio? Mientras tanto se construye con un servicio simulado, sin enviar correos reales.
2. **Aviso de privacidad.** El formulario y el chat piden aceptarlo. ¿La agencia piloto tiene uno publicado en su web? Si no, se deja un enlace configurable y, mientras tanto, un texto genérico de ejemplo marcado como borrador.
3. **¿Cuántos mensajes al día y por qué canal llegan hoy?** No bloquea; ayuda a fijar el tiempo máximo y los límites de envío.

## Trazabilidad

| Requisito | Criterio | Tarea |
| --- | --- | --- |
| RF-260 | AC-260 | T-028 |
| RF-261, RF-271 | AC-261, AC-273 | T-027 |
| RF-262, RF-270 | AC-262, AC-272, AC-274 | T-027 |
| RF-263, RF-264 | AC-263, AC-264, AC-265 | T-029 |
| RF-265 | AC-266, AC-267, AC-275 | T-030 |
| RF-266 | AC-268 | T-029, T-028 |
| RF-267, RF-268 | AC-269, AC-270 | T-029, T-031 |
| RF-269 | AC-271 | T-031 |
