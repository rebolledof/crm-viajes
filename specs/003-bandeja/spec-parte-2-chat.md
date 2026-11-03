# SPEC-003 parte 2: chat web

- Estado: alcance aprobado por Felipe el 3 nov 2026 ("Si para ambas": D-16 y D-17). Detalla el punto 7 de `spec.md`; lo que no se repite aquí sigue igual que en la parte 1.
- Tarea: T-027b. Criterios nuevos: AC-277 a AC-288 (AC-272 ya estaba en `spec.md`).

## Qué resuelve

Muchos clientes escriben desde la web de la agencia en el momento en que miran un destino. Con el chat, ese mensaje entra a la misma bandeja que el formulario, con el mismo dueño, la misma alerta de "Sin responder" y las mismas respuestas guardadas, y el asesor responde sin salir del CRM.

## Cómo funciona

1. **Instalar.** En Configuración › Canales, el administrador enciende el chat y copia una línea de código para pegar en su web: `<script src="https://<app>/c/<código>/burbuja.js" async></script>`. Ese archivo solo dibuja un botón redondo con el color de la agencia y, al pulsarlo, abre una ventana (`iframe`) servida por el CRM en `/c/<código>`. La web de la agencia nunca ve los mensajes ni los datos del visitante.
2. **Primer mensaje.** La ventana muestra el nombre y logo de la agencia y pide nombre, teléfono o correo (al menos uno), el mensaje y la casilla del aviso de privacidad. Tiene el mismo campo trampa del formulario.
3. **Conversación.** Al enviar, el visitante ve su mensaje y "Un asesor te responderá pronto". Las respuestas aparecen solas en la ventana con el nombre de pila del asesor ("Ana · 10:42"). Puede seguir escribiendo.
4. **Volver más tarde.** El navegador guarda una llave secreta de la conversación. Si el visitante vuelve en el mismo navegador, ve su historial y sigue escribiendo. La llave vence a los 30 días sin mensajes; después, el chat empieza de cero (la conversación anterior sigue en la bandeja).
5. **Fuera de horario.** Con el horario laboral de S02b, la ventana avisa: "Estamos fuera de horario. Te respondemos el <día> desde las <hora>." El visitante puede escribir igual.
6. **Pausado.** Si el administrador pausa el chat, la ventana avisa "Este chat no está recibiendo mensajes ahora" con los otros medios de contacto, y un mensaje enviado desde una ventana ya abierta se rechaza conservando el texto.
7. **En la bandeja.** La conversación entra con canal "Chat". Va al responsable de la oportunidad abierta del contacto si la hay; si no, a "Sin asignar". El asesor escribe en la misma caja de la parte 1 y pulsa **Enviar**: el mensaje sale directo a la ventana del visitante (no se abre WhatsApp ni el correo). Si el cliente vuelve a escribir, la conversación se reabre.
8. **Oportunidad.** El chat no crea oportunidad, porque también escriben proveedores o clientes con viaje en curso. En la tarjeta "Qué hacer ahora" de la conversación aparecen **"Crear oportunidad"** (en la primera etapa, origen "Chat web", responsable el de la conversación o quien la crea, dispara las plantillas de S02b) y **"Vincular a una oportunidad"** (elige entre las oportunidades abiertas del contacto).
9. **Resolver.** Al resolver una conversación sin oportunidad, se pregunta "¿Era una consulta de viaje?": **Sí** abre "Crear oportunidad"; **No, resolver** la resuelve; también se puede cerrar la pregunta sin elegir.
10. **Datos sin verificar (D-16).** Igual que en el formulario: si el teléfono o correo del chat corresponde a un contacto que ya existía y el visitante deja otro dato nuevo, ese dato nuevo queda "sin verificar" hasta que un asesor lo confirme.
11. **Página de prueba (D-17).** En Canales, el administrador tiene **"Probar el chat"**: abre una página de ejemplo con aspecto de web de agencia ("Así se verá en tu web") con la burbuja de su propia agencia. Solo la ve un administrador con sesión; no es pública ni toca ninguna web real.

## Requisitos

- RF-272: El chat crea o vincula el contacto (reglas de duplicados de S02 y D-16), registra el consentimiento por los canales que dejó y crea una conversación con canal "Chat" y su primer mensaje. No crea oportunidad.
- RF-273: El visitante ve los mensajes de su conversación, entrantes y salientes, en orden, y nada más. La llave del visitante es aleatoria, se guarda en la base solo como huella y vence a los 30 días sin mensajes.
- RF-274: Una respuesta del asesor por chat queda como mensaje saliente con su autor y hora, deja la conversación pendiente y aparece en la ventana del visitante en 10 segundos o menos mientras esté abierta.
- RF-275: "Crear oportunidad" y "Vincular a una oportunidad" enlazan la conversación con una oportunidad de la misma agencia y del mismo contacto. Lectura no puede.
- RF-276: El chat aplica el límite de envíos (nuevas conversaciones: 5 en 10 minutos por dirección y chat, 200 por agencia; mensajes: 30 en 10 minutos por conversación), el campo trampa, el máximo de 4.000 letras y el rechazo con el canal pausado.

## Criterios de aceptación

- AC-277 (RF-272): Dado el chat activo de la agencia A, cuando un visitante deja nombre, teléfono, acepta el aviso y escribe, entonces aparece en "Sin asignar" de A una conversación con canal "Chat", un contacto nuevo con ese teléfono y el consentimiento registrado, y ninguna oportunidad nueva.
- AC-278 (RF-274): Dada esa conversación, cuando Ana responde "Hola" desde la bandeja, entonces la conversación pasa a pendiente con "Ana" como autor y el visitante ve "Hola" con el nombre "Ana" en su ventana sin recargarla, en 10 segundos o menos.
- AC-279 (RF-273, AC-265): Dada una conversación de chat resuelta, cuando el visitante vuelve en el mismo navegador al día siguiente, entonces ve su historial; cuando escribe, entonces la conversación vuelve a abierta.
- AC-272 (RF-273): Dados dos visitantes del chat, cuando uno pide los mensajes con el identificador de la conversación del otro o con una llave inventada, entonces no recibe nada.
- AC-280 (RF-273): Dada una llave de visitante sin mensajes desde hace más de 30 días, cuando el visitante abre el chat, entonces ve el formulario de primer mensaje y no el historial anterior.
- AC-281: Dado que son las 8 p. m. y el horario laboral termina a las 6 p. m., cuando el visitante abre el chat, entonces ve el aviso de fuera de horario con el día y la hora de regreso, y puede escribir.
- AC-282 (RF-276): Dado el chat pausado, cuando un visitante con la ventana ya abierta envía un mensaje, entonces ve "Este chat no está recibiendo mensajes ahora", su texto sigue en la caja y no se crea nada.
- AC-283 (RF-275): Dada una conversación de chat sin oportunidad, cuando Ana pulsa "Crear oportunidad", entonces se crea una oportunidad del contacto en la primera etapa con origen "Chat web" y responsable Ana, arrancan las tareas automáticas y la conversación queda vinculada; cuando en otra conversación elige "Vincular" y una oportunidad abierta del contacto, entonces queda vinculada a ella. Lectura no ve los botones y el servidor rechaza la acción.
- AC-284 (RF-275): Dada una conversación de chat sin oportunidad, cuando Ana pulsa "Resolver", entonces se le pregunta "¿Era una consulta de viaje?"; con "Sí" pasa a crear la oportunidad; con "No, resolver" queda resuelta sin oportunidad.
- AC-285 (RF-276): Dados 5 chats nuevos desde la misma dirección en 10 minutos, cuando llega el sexto, entonces se rechaza con "Recibimos muchos mensajes seguidos. Espera unos minutos." conservando lo escrito; un mensaje de más de 4.000 letras se rechaza indicando el máximo; el campo trampa lleno no crea nada.
- AC-286 (D-16): Dado un contacto existente con teléfono 300 555 0101, cuando llega un chat con ese teléfono y un correo nuevo, entonces el correo queda "sin verificar" y la conversación se vincula a ese contacto.
- AC-287 (D-17): Dado un administrador, cuando pulsa "Probar el chat" en Canales, entonces ve la página de ejemplo con la burbuja de su agencia y puede conversar con ella; un asesor o una persona sin sesión no puede abrir esa página.
- AC-288: Dada la web de la agencia con la línea de código, cuando el visitante abre la burbuja en un celular de 375 px, entonces la ventana ocupa la pantalla, se cierra con un botón visible o con Escape, y la web de la agencia no recibe ningún dato del visitante.

## Datos (se detalla en plan.md)

- `inbound_channels` ya admite `chat`: cada agencia recibe su canal de chat (pausado al crearse, para que no aparezca en ninguna web sin que el administrador lo encienda).
- Nueva tabla `chat_visitors` (con `agency_id` y RLS, sin acceso de anon): conversación, huella de la llave, último uso. La llave sola no se guarda.
- Funciones públicas nuevas en el esquema `app` (`security definer`, solo ejecutables por anon): datos del chat (marca, activo, horario), iniciar chat, enviar mensaje y leer mensajes. Todas sacan la agencia del código del chat y validan la llave; nunca reciben `agency_id`.
- `conversations` ya tiene canal `chat` y `messages` ya admite `chat` en ambas direcciones.
- Migración solo aditiva.

## Decisiones

- D-16 (Felipe, 3 nov 2026): los datos nuevos que llegan por el chat a un contacto existente quedan "sin verificar", igual que en el formulario (D-14).
- D-17 (Felipe, 3 nov 2026): se incluye una página de prueba con la burbuja, solo para el administrador con sesión, para probar sin tocar una web real.
- La ventana pregunta por mensajes nuevos cada 5 segundos mientras está abierta y visible, y cada 30 segundos tras 2 minutos sin actividad; cerrada, no pregunta. Así cabe en el plan gratuito sin conexión en tiempo real.
- El visitante ve solo el nombre de pila del asesor, no su correo ni su apellido.
- La burbuja vive en un `iframe` del dominio del CRM: la web de la agencia no puede leer la conversación y el CRM no ejecuta código de la agencia.
- El chat se responde solo por chat en esta parte. Si el visitante dejó teléfono o correo, el asesor puede seguir por WhatsApp o correo desde la ficha como en S02.
- Mensajes de solo texto, sin archivos ni imágenes.
