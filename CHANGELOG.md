# Registro de cambios

## [Sin publicar]

### Añadido

- SPEC-004 Cotizador, parte 1 (datos y dinero): cotizaciones por oportunidad con número consecutivo por agencia, versiones con borrador único, ítems con coste y venta en COP o USD y tipo de cambio, cálculo exacto en la base (redondeo por ítem, COP sin decimales y USD con 2), utilidad, margen y recargo, aviso de margen bajo (10 % por defecto), versiones enviadas que no cambian nunca (ni sus ítems) con su total, margen mínimo, marca y logo copiados, estados que solo avanzan, catálogo simple y ajustes del cotizador. Lectura no ve costes. Todavía sin pantallas (parte 2). Migración `20261109000000_cotizador.sql`; ADR 0003.
- SPEC-004 Cotizador, parte 2 (pantallas): botón "Nueva cotización" y tarjeta de cotizaciones en la oportunidad; armar la cotización en 3 pasos (servicios y precios, condiciones, revisar) con totales, utilidad y margen que se calculan mientras se escribe, aviso ámbar de margen bajo, tipo de cambio cuando un coste está en otra moneda y vista de cómo la verá el cliente; catálogo de servicios y ajustes de cotizaciones para el administrador. Enviar llega en la parte 3.
- SPEC-004 Cotizador, parte 4 (PDF): al enviar se genera el PDF con el logo y el color de la agencia, número, versión, vigencia, cliente, viaje, servicios (o solo el total), condiciones y pie con el asesor; se guarda con la versión y no cambia nunca, aunque la agencia cambie su logo. "Descargar PDF" en la cotización y en la oportunidad (también para Lectura) y vista previa "BORRADOR" antes de enviar. Nunca lleva coste, proveedor, utilidad, margen ni tipo de cambio. Migración `20261111000000_cotizacion_pdf.sql`; ADR 0004.
- SPEC-004 Cotizador, parte 3 (enviar): "Enviar al cliente" con confirmación (total, aviso de margen bajo y qué pasa con la oportunidad); la versión queda congelada, la anterior pasa a Sustituida y la oportunidad avanza a "Propuesta enviada" con su seguimiento si estaba antes. "El cliente aceptó" y "El cliente la rechazó" desde la cotización y la oportunidad, con quién y cuándo en la auditoría; al aceptar se ofrece marcar la oportunidad ganada. Historial de versiones en la tarjeta de la oportunidad y "Cotizaciones por vencer" en Mi día (2 días antes). Sin migración nueva. El PDF llega en la parte 4.
- Informe de pruebas del cotizador (6 nov 2026): a quien le retiraron el acceso a su agencia y no tiene otra activa ya no le aparece "Crea tu agencia"; ve "Tu acceso fue retirado" con el nombre de la agencia y cómo volver a entrar con una invitación nueva. La base también le impide crear una agencia aunque llame directo. Decisión de Felipe del 6 nov 2026. Migración `20261110000000_acceso_retirado.sql`.
- Cotizador, prueba independiente (5 nov 2026): un ítem ya no puede entrar en una versión que se está enviando al mismo tiempo; el tipo de cambio y el margen mínimo quedan en una tabla aparte que Lectura no lee; se puede borrar un borrador con ítems, pero no la única versión; dos "nueva versión" a la vez dan un aviso claro; una versión solo pasa a sustituida si hay otra enviada más reciente; un ítem no puede usar un servicio del catálogo de otra agencia; un importe demasiado grande se marca en su campo.
- Informe de pruebas del chat web (4 nov 2026): un error inesperado muestra "Algo salió mal" en español con "Intentar de nuevo", en vez de la página técnica en inglés; una dirección con un "%" mal escrito (por ejemplo `/c/%ZZ`) responde "No encontramos esta página" en español en vez de "Internal Server Error"; una palabra muy larga ya no se corta en la burbuja del chat, en la bandeja ni en Respuestas guardadas en el celular.
- SPEC-003 parte 2, chat web: burbuja para la web de la agencia (una línea de código), ventana con la marca de la agencia, primer mensaje con nombre, teléfono o correo y aviso de privacidad, respuestas del asesor en la misma ventana sin recargar, historial al volver en el mismo navegador (30 días), aviso de fuera de horario y chat pausado. En la bandeja: "Enviar por chat", "Crear oportunidad", "Vincular a una oportunidad" y "¿Era una consulta de viaje?" al resolver sin oportunidad. Canales: encender el chat, copiar su código y página de prueba solo para el administrador (D-17). Los datos nuevos de un contacto existente llegan sin verificar (D-16). Migración `20261108000000_chat_web.sql`.
- Chat web, prueba independiente (3 nov 2026): con la burbuja cerrada la ventana deja de preguntar por mensajes; si la conversación vence con la ventana abierta, el visitante vuelve al primer mensaje con un aviso y su texto conservado; Escape cierra la burbuja también desde la web de la agencia; Enter no envía mientras se compone una letra; el campo trampa ya no deja una llave falsa; la dirección del código va escapada y la burbuja se guarda en caché por dominio.
- SPEC-003 Bandeja unificada (parte 1): bandeja con filtros Sin responder, Mías, Sin asignar, Todas y Resueltas, búsqueda por nombre, teléfono o correo, y conversación con "Qué hacer ahora" (Responde → Oportunidad → Siguiente paso).
- Formulario web público con la marca de la agencia (enlace o código para incrustar): crea o reutiliza el contacto, registra el consentimiento, crea la oportunidad con sus tareas de seguimiento y la conversación. Con campo trampa y límite de envíos.
- Responsable por conversación: cola "Sin asignar" con botón "Tomar"; el administrador reasigna. Estados abierta, pendiente y resuelta automáticos.
- Alerta de sin responder con el reloj en horario laboral (30 minutos por defecto, configurable): número rojo en el menú, franja para el administrador en Mi día y en la Bandeja, y primer paso "Responde los mensajes" en el plan del día.
- Respuestas guardadas de la agencia y personales, con 5 de ejemplo; se insertan escribiendo "/" y reemplazan {nombre}, {asesor} y {agencia}.
- Administración › Canales de entrada: activar o pausar el formulario, copiar su enlace o código, enlace al aviso de privacidad y tiempo máximo sin respuesta.
- ADR 0002: entrada pública con el rol anon y funciones del esquema app.
- Documentación base: constitución, resumen de producto, roadmap, glosario y AGENTS.md.
- SPEC-000 MVP piloto con los problemas que nombró la agencia piloto; ADR 0001 del stack aceptado.
- Proyecto Next.js 16.3 con TypeScript estricto, Tailwind y Supabase Auth.
- Migración base: agencias, membresías con roles (admin, asesor, lectura), invitaciones con vencimiento de 7 días y auditoría, todo con RLS por agencia.
- Pantallas: login, registro, confirmación de correo, crear agencia, cambiar de agencia, equipo (invitar, cambiar rol, quitar acceso), aceptar invitación y auditoría.
- Pruebas unitarias e integración contra PostgreSQL real; CI en GitHub Actions.
- SPEC-002: contactos con varios teléfonos y correos normalizados, aviso de duplicados y consentimientos por canal y finalidad.
- Embudo propio de cada agencia (10 etapas iniciales que el administrador renombra, ordena, agrega o desactiva) y oportunidades que saltan a cualquier etapa activa.
- Cierre ganado con evidencia, perdido con motivo (y nota si es "otro") y reapertura con razón; todo en historial y auditoría.
- Presupuesto con importe exacto y moneda (COP o USD); campos desconocidos se muestran como "Desconocido".
- Tareas con resultado obligatorio al completar, próxima acción en el tablero y pantalla "Mi día" con la alerta "sin próxima acción".
- Una tarea creada desde la ficha del contacto queda ligada a una oportunidad (por defecto la abierta más reciente), para que cuente como su próxima acción.
- Módulo de Tareas: todas las tareas de la agencia agrupadas en vencidas, hoy y próximas, con filtros por responsable, estado y tipo (RF-218).
- Mi día muestra también las próximas tareas, no solo las de hoy y vencidas.
- Los formularios conservan lo escrito cuando hay un error y resaltan el campo con el problema (contactos, oportunidades, tareas, etapas, consentimiento, agencia, invitaciones, login y registro).
- Regla de usabilidad en AGENTS.md: lista que se revisa en cada pantalla.
- Recuperar contraseña: enlace "Olvidé mi contraseña" en el login, correo con enlace y pantalla para elegir la nueva.
- El login avisa cuando falta confirmar el correo.
- La pantalla de registro explica el motivo cuando Supabase rechaza la cuenta (límite de correos, contraseña débil, correo existente).
- Botón de WhatsApp con mensaje prellenado y editable que respeta el consentimiento y queda en la ficha.
- SPEC-002b Plantillas de seguimiento: las tareas se crean solas al llegar una oportunidad, al entrar en una etapa, al ganar o al perder (con filtro de motivos), con fecha dentro del horario laboral y mensaje sugerido.
- Seis plantillas precargadas para agencia de viajes (contacto rápido, calificado, propuesta enviada, negociación, ganado y reactivación de perdidos), editables por el administrador.
- Las tareas automáticas pendientes se cancelan solas al llegar a la etapa de parada, al cerrar o al reabrir, y pasan al nuevo responsable si cambia.
- Niveles de edición por plantilla (bloqueada, ajustable, libre) y pasos bloqueados, validados en el servidor y en la base.
- Plantillas personales de los asesores, apagadas por defecto; el administrador las habilita.
- Horario laboral de la agencia (por defecto lunes a viernes 8 a 18 y sábado 8 a 12, hora de Colombia).
- Tipo de tarea WhatsApp; las tareas de WhatsApp y correo abren la app o el programa de correo con el mensaje relleno, sin enviar nada solas.
- Las tareas abiertas se pueden ajustar (fecha, prioridad, mensaje y asignada) según el rol y el nivel.
- Si una pantalla falla en el servidor, se muestra un aviso en español con el menú visible y la opción de reintentar, en lugar de la página genérica de Next.js.
- Oportunidades tiene vista "Lista" además del tablero, con búsqueda por cliente, destino, correo o teléfono (completo o un trozo de 4 dígitos o más) (hallazgo F-01 de QA, AC-219).
- Las tareas de WhatsApp y correo muestran el botón deshabilitado y el motivo cuando el cliente retiró el permiso o le falta el teléfono o el correo (AC-219a).
- Los avisos de validación del navegador salen en español y nombran el campo, en todos los formularios (AC-219b).
- Auditoría en lenguaje de la agencia: "Activó la etapa «Nuevo»", "Completó la tarea «Llamar»", con detalles legibles en vez de claves y JSON (AC-219c).
- Las plantillas de Seguimientos se listan en el orden del embudo; antes el orden de las seis precargadas podía cambiar entre cargas.
- Regla de prueba independiente en AGENTS.md: otro agente con un modelo distinto prueba cada cambio antes del merge y luego se actualiza el tablero.
- La búsqueda de contactos encuentra por parte del teléfono (desde 4 dígitos).
- La auditoría muestra en español los eventos de contactos, oportunidades, etapas y tareas, con "de etapa a etapa" y la razón.
- Los campos obligatorios llevan un asterisco rojo.

- SPEC-002c Nuevo diseño (estilo A): encabezado con el logo y el nombre de la agencia, pestañas con la pestaña activa marcada, tarjetas y encabezado común en todas las pantallas.
- Marca por agencia: el administrador elige color principal, color de acento y logo (PNG, WebP o JPG de hasta 512 KB) en "Marca de la agencia", con vista previa en vivo y aviso si el color es muy claro. Sin logo se muestran las iniciales. Cada cambio queda en auditoría con el color anterior y el nuevo.
- Cada persona elige el menú arriba o a la izquierda (que se puede comprimir a solo íconos) y el tema Claro, Oscuro o Automático; se guarda en su cuenta y se aplica sin parpadeo. Por defecto: arriba y claro.
- Mi día muestra "Tu plan de hoy" en cuatro pasos con flechas (vencidas, hoy, dar siguiente paso, día al día), el avance del día, las tareas agrupadas con la etapa de su oportunidad y un botón "Definir paso" para las oportunidades sin tarea.
- La ficha de la oportunidad muestra el camino de etapas con la actual resaltada, la meta de la etapa y "Qué hacer ahora". Al completar la última tarea de una oportunidad abierta pregunta "¿Cuál es el siguiente paso?".
- El tablero de oportunidades tiene flechas entre columnas, la meta de cada etapa y una marca roja en las oportunidades vencidas o sin siguiente paso.
- La lista de contactos muestra la etapa del viaje en curso y el siguiente paso (vencido, hoy, programado o "Sin siguiente paso"); en el celular se ve como tarjetas.
- La ficha del contacto muestra el viaje en curso con su camino de etapas.
- En "Etapas del embudo" el administrador escribe la meta de cada etapa.
- El nombre de la agencia se cambia ahora en "Marca de la agencia" (antes estaba en Mi día).
- Login, registro y recuperar contraseña con el nuevo estilo.
- Contraste AA revisado con axe-core en claro y oscuro con dos marcas.
- "¿Cuál es el siguiente paso?" se puede dejar para después; la oportunidad queda en «Sin siguiente paso» de Mi día (prueba independiente).
- Al cambiar el menú o el tema se vuelve a la misma pantalla sin repetir el aviso anterior.
- Una tarea de llamada sin teléfono en el contacto lo dice y explica cómo corregirlo.
- Un logo de más de 512 KB o un archivo que no es imagen aunque se llame .png ya no muestra "No pudimos cargar esta pantalla": se revisa antes de enviarlo, se avisa sobre el campo del logo y los colores escritos se conservan (hallazgo F-02 de QA, AC-242).
- Prueba independiente de SPEC-003 parte 1 (Sonnet): el enlace mailto codifica el destinatario y el formulario solo acepta correos sin "?" ni "&"; un formulario no vuelve a otorgar un permiso retirado; no se asigna una conversación a alguien de solo lectura; "Resolver" pide confirmación; la casilla del formulario en Canales conserva lo marcado si el guardado falla; el campo trampa ya no lo llena el autocompletado; una conversación resuelta avisa que responder la deja en Pendiente.
- Datos sin verificar (D-14): un teléfono o correo que llega por el formulario web a un contacto existente queda marcado "Sin verificar" en la ficha y no se usa para responder ni en las tareas hasta que un asesor lo confirma con "Sí, es del cliente". Migración `20261106000000_datos_sin_verificar.sql`. Tras la prueba independiente: un dato sin verificar no queda como preferido al guardar la ficha ni aparece en el listado de contactos; al confirmarlo pasa a preferido si no había otro; la oportunidad y las tareas de llamada explican que falta confirmarlo.
- Informe de pruebas del 3 nov 2026: el límite de 5 envíos del formulario cuenta los últimos 10 minutos (antes, bloques fijos del reloj dejaban pasar el sexto envío); un código de formulario que no existe muestra "No encontramos este formulario" en español, y cualquier otra página inexistente, "No encontramos esta página". Pruebas automáticas del sexto envío y de agency_id en el cuerpo por la acción del servidor. Migración `20261107000000_limite_ventana_movil.sql`.
- Prueba independiente de esos ajustes: la página "No encontramos este formulario" ahora la pinta el servidor; antes llegaba en blanco hasta que cargaba JavaScript y con el título del formulario.

### Corregido (prueba independiente de S02, 1 nov 2026)

- Las tareas, oportunidades y contactos de una persona retirada de la agencia ya se pueden completar, cancelar, mover y editar; antes daban error. Asignarle algo nuevo sigue prohibido (migración 20261103000200).
- Un parámetro repetido en la URL (?q=a&q=b) ya no rompe las listas.
- Un identificador alterado en un formulario o en la URL responde "no encontrado" en vez de un error interno.
- Una tarea con una oportunidad de otro contacto muestra un mensaje claro; WhatsApp ya no registra el mensaje en una oportunidad de otro contacto.
- Una fecha que no existe (30 de febrero) se rechaza en vez de correrse al mes siguiente.
- Al editar, un responsable que ya no está en la agencia se conserva en vez de borrarse.
- El campo de viajeros acepta hasta 999, igual que el servidor.
- Oportunidades sin resultados explica qué hacer (cambiar el filtro o crear una desde un contacto).
