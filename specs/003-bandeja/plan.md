# Plan técnico SPEC-003 (parte 1: bandeja, formulario web, respuestas guardadas y alertas)

## Datos

Una migración nueva y aditiva: `20261105000000_bandeja.sql`. No borra ni cambia datos; solo agrega tablas, dos columnas con valor por defecto en `agency_settings`, funciones, y vuelve a definir `create_agency` para sembrar lo de la bandeja.

| Tabla | Contenido | Reglas clave |
| --- | --- | --- |
| `inbound_channels` | canal de entrada por agencia (`formulario`; luego `chat` y `correo`), código público aleatorio, activo o pausado | solo el administrador lo ve y lo pausa (RLS) |
| `conversations` | contacto, oportunidad, canal, responsable, estado, último mensaje del cliente y nuestro, `reply_due_at` | todos los miembros leen; admin y asesor actualizan solo responsable, estado y oportunidad; el trigger `conversations_rules` deja al asesor solo "tomar para sí" y solo marcar resuelta |
| `messages` | dirección (entrante o saliente), vía, texto (hasta 4000), autor, identificador externo único por agencia | por RLS un usuario solo inserta respuestas propias sin identificador externo; los entrantes solo los crean las funciones de entrada |
| `saved_replies` | título, atajo único por dueño, texto; dueño vacío = de la agencia | de la agencia: solo admin escribe; personales: solo su dueño las ve y las cambia |
| `agency_settings` (+2) | `max_unanswered_minutes` (5 a 1440, por defecto 30) y `privacy_url` | solo admin |
| `app.inbound_rate` | conteo de envíos por ventana de 10 minutos | sin acceso para ningún rol de la app |

## Estados y reloj

- Trigger `messages_apply` (después de insertar un mensaje): un entrante deja la conversación **abierta** y, si no tenía plazo, calcula `reply_due_at` con `app.business_deadline` (minutos dentro del horario laboral de S02b); un saliente la deja **pendiente** y borra el plazo. Resolver borra el plazo.
- "Sin responder" = abierta y `reply_due_at` vencido. Se calcula al leer, así no hace falta una tarea programada (sirve en el plan gratuito).

## Entrada pública

- La página `/f/<código>` y su acción corren con `withAnon` (rol `anon`). Ese rol solo puede ejecutar `app.web_form_info`, `app.web_form_logo` y `app.submit_web_form`, que están en el esquema `app`: la API pública de Supabase (PostgREST) no lo expone, así que no se pueden llamar con la clave anónima saltándose el servidor.
- `app.submit_web_form` saca la agencia del código del formulario, aplica el límite de envíos, busca el contacto por teléfono o correo (o lo crea), registra el consentimiento de servicio por los canales que dejó, crea la oportunidad en la primera etapa abierta (dispara las plantillas de S02b), la conversación y el mensaje. Si el contacto ya tenía una oportunidad abierta con responsable activo, conversación y oportunidad nuevas van a esa persona.
- Campo trampa invisible en el servidor; validación en el navegador y en el servidor (`parseWebForm`), y de nuevo lo esencial en la base.
- ADR 0002 explica la decisión.

## Código

- `src/domain/inbox.ts`: estados, siguiente paso, guía "Qué hacer ahora", tiempo de espera, relleno de respuestas guardadas, atajos, validación del formulario y código para incrustar.
- `src/domain/guide.ts`: `dayPlan` suma el paso "Responde los mensajes" cuando recibe el número.
- `src/server/inbox.ts`: listas por filtro con búsqueda, conteos, conversación, tomar, asignar, resolver, responder (WhatsApp o correo con el texto), respuestas guardadas y ajustes de canales.
- `src/server/public-form.ts`: información del formulario, logo y envío.
- Pantallas: `/app/bandeja` (lista, conversación y guía en tres columnas; en el celular, lista o conversación), `/app/bandeja/respuestas`, `/app/configuracion/canales`, `/f/[key]` y `/f/[key]/logo`. Menú: "Bandeja" con número rojo y "Canales de entrada" en Administración. Mi día: primer paso "Responde los mensajes" y alerta del equipo para el administrador.

## Pruebas

- Unitarias (`tests/unit/bandeja.test.ts`): sin responder, tiempo de espera, siguiente paso, guía, permisos por rol, plan del día (AC-275), respuestas guardadas (AC-271), formulario (AC-273) y código para incrustar.
- Integración (`tests/integration/bandeja.test.ts`, PostgreSQL real): formulario completo con tareas y consentimientos (AC-261), contacto existente y responsable (AC-264), agencia por código y formulario pausado (AC-262), límite de envíos y campo vacío (AC-274), rol anon sin acceso a tablas ni funciones internas, tomar y reasignar (AC-263), estados (AC-265), reloj de horario laboral (AC-266, AC-267), conteos y alerta (AC-266, AC-275), respuesta con autor y canal (AC-268), permisos retirados, Lectura y otra agencia (AC-269), respuestas guardadas (AC-270).
- AC-260 (correo duplicado) y AC-272 (chat) llegan con las partes 3 y 2.

# Parte 2: chat web

## Datos

Migración aditiva `20261108000000_chat_web.sql`:

| Objeto | Contenido | Reglas clave |
| --- | --- | --- |
| `inbound_channels` (kind `chat`) | un canal por agencia, pausado al crearse | `seed_inbox` lo siembra; las agencias existentes lo reciben en la migración |
| `chat_visitors` | conversación y huella sha256 de la llave del visitante | RLS sin políticas y sin permisos: solo las funciones del chat la leen |
| `app.chat_info` | marca, activo, si la agencia está en horario, hora en que abre y hora local | anon |
| `app.chat_start` | valida, límite (5 por dirección y chat, 200 por agencia), contacto con D-16, consentimiento, conversación sin oportunidad (responsable si el contacto tiene oportunidad abierta), primer mensaje y huella | anon |
| `app.chat_send` | valida la llave (30 días), límite de 30 mensajes por conversación en 10 minutos, mensaje entrante (reabre) | anon |
| `app.chat_messages` | mensajes de chat y formulario de esa conversación, con el nombre de pila del asesor | anon; llave inválida: ninguna fila |
| `app.web_form_logo` | sirve el logo también con el código del chat | anon |

## Código

- `src/domain/chat.ts`: validación del primer mensaje y de los siguientes, aviso de fuera de horario, ritmo de consulta, código para pegar y script de la burbuja.
- `src/server/public-chat.ts`: llave nueva (32 bytes) y su huella, información, inicio, envío y lectura con `withAnon`.
- `src/server/inbox.ts`: `replyConversation` acepta `chat` (sin enlace), `createConversationOpportunity`, `linkConversationOpportunity`, `getConversation.linkableOpportunities` y el interruptor del chat en los ajustes.
- Pantallas: `/c/[key]` (ventana), `/c/[key]/burbuja.js` (script), `/app/configuracion/canales/prueba-chat` (D-17, la web de ejemplo va en un marco para que la burbuja no quede en el resto del CRM), tarjeta "Chat web" en Canales, "Enviar por chat", "Crear oportunidad", "Vincular" y "¿Era una consulta de viaje?" en la Bandeja.

## Pruebas

- Unitarias (`tests/unit/chat.test.ts`): primer mensaje y máximo de letras (AC-285), llave, fuera de horario (AC-281), ritmo de consulta y burbuja (AC-288: solo escucha al CRM y no deja inyectar código con el nombre de la agencia).
- Integración (`tests/integration/chat.test.ts`): canal pausado por defecto y códigos que no se cruzan, AC-277, AC-286 (D-16), AC-264 por chat, validación en la base, AC-278, vía de la respuesta, AC-279, AC-272 (llave de otro, inventada y de otra agencia), AC-280, AC-282, AC-285 (sexto chat y ráfaga), AC-283 (crear y vincular, con otra agencia y otro contacto), Lectura y acceso de roles a `chat_visitors` y funciones de anon.
- AC-284 y AC-287 se revisaron en el navegador (recorrido a 375 px y en escritorio).
