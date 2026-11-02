# SPEC-002c Nuevo diseño: estilo A, marca por agencia, preferencias y guía paso a paso

- Estado: Aprobada por Felipe el 2 nov 2026 ("Aprobada"). Preguntas 1 y 2 resueltas con la recomendación: la lista por etapa queda fuera de esta etapa y, cuando llegue, solo avisará.
- Propietario: Felipe
- Sprint: etapa de diseño después de cerrar S02 (épica DISEÑO, tareas T-063 a T-066)
- Deriva de: pedidos de Felipe del 2 nov 2026 y la propuesta visual aprobada ("Ese es el diseño que quiero"). Imágenes y detalle en la carpeta del proyecto `diseno/propuesta-v1`, `v2` y `v3`.

## Problema

El diseño actual es una lista plana sin jerarquía visual ni marca. Los asesores de la agencia nunca han usado un CRM y hoy trabajan sin orden, así que el sistema tiene que decirles qué hacer y en qué orden. Además, al ser un SaaS para varias agencias, cada una debe ver su propio logo y sus colores.

## Usuarios

- Administrador o dueño: configura la marca de la agencia.
- Asesor y Lectura: usan el CRM con la marca de su agencia y eligen sus preferencias de menú y tema.

## Alcance incluido

1. **Estilo A (empresarial, inspirado en Salesforce Lightning)** en todo el área `/app`: encabezado con logo, búsqueda global y avatar; tarjetas con borde; encabezado de página con ícono; tipografía Inter; densidad media.
2. **Marca por agencia**: nombre (ya existe), logo cuadrado, color principal y color de acento. Los tonos suaves y oscuros se calculan desde esos dos colores. Por defecto, los colores de "Andes Travel" de las imágenes (`#0F6E6E` y `#F28C28`) y sin logo (se muestran las iniciales de la agencia).
3. **Pantalla "Configuración › Marca"** (solo administrador): subir o quitar el logo, elegir los dos colores con vista previa en vivo y guardar.
4. **Preferencias personales** en el menú del avatar:
   - Ubicación del menú: **Arriba** (por defecto) o **A la izquierda**.
   - Menú a la izquierda abierto (logo, ícono y nombre) o comprimido (solo logo e íconos; el nombre aparece al pasar el mouse). Por defecto abierto.
   - Tema: **Claro** (por defecto), **Oscuro** o **Automático** (sigue el ajuste del equipo).
5. **Guía paso a paso** con los datos que ya existen:
   - Mi día: franja "Tu plan de hoy" con 4 pasos en orden (vencidas → hoy → dar siguiente paso → día al día), flechas y barra de avance; tareas agrupadas en "Vencidas" y "Para hoy", cada una con la etapa de su oportunidad y un solo botón de acción según su tipo (Llamar, WhatsApp, Escribir).
   - Ficha de contacto y de oportunidad: camino de etapas con flechas y "Estás aquí" (etapas activas de la agencia en su orden, más el cierre), y tarjeta "Qué hacer ahora" con la próxima acción.
   - Tablero de oportunidades: flechas entre columnas y una línea de meta por etapa.
   - Lista de contactos: columna "Siguiente paso" con su estado (vencida, hoy, programada o sin siguiente paso).
   - Al completar la última tarea abierta de una oportunidad abierta, el CRM pide programar la siguiente (se puede omitir, y entonces la oportunidad aparece en "Sin siguiente paso").
6. **Pantallas cubiertas**: Mi día, Contactos (lista y ficha), Oportunidades (tablero, lista y ficha), Tareas, Seguimientos, Etapas del embudo, Equipo, Auditoría, Configuración › Marca, login y registro (con el estilo, sin marca de agencia).
7. **Celular**: con cualquier preferencia, en pantallas angostas el menú es un cajón que se abre con un botón.

## Alcance excluido

Logo horizontal y logo para modo oscuro, marca en correos y PDF (llega con el cotizador en S04), tipografía por agencia, dominio propio por agencia, cambiar los colores de estado (rojo, ámbar, verde), la lista de verificación configurable por etapa (ver Preguntas).

## Requisitos funcionales

- RF-240: Solo el administrador o dueño de una agencia puede leer y cambiar la configuración de marca en la pantalla de configuración y guardarla; también en la base de datos (RLS) y en el almacenamiento del logo.
- RF-241: Toda la app usa el logo, el nombre y los colores de la agencia activa, tomada de la sesión verificada; nunca de un valor enviado por el cliente.
- RF-242: El servidor valida el formato de los colores (`#RRGGBB`) y el logo (PNG, WebP o SVG saneado, máximo 512 KB). Si el color principal no da un contraste mínimo de 4.5:1 con el texto de los botones, se avisa y se sugiere un tono; lo elegido no se borra.
- RF-243: Las preferencias de menú y tema son de cada usuario, valen en todas sus agencias y se aplican en el servidor (sin parpadeo al cargar).
- RF-244: Los valores por defecto son menú arriba, menú lateral abierto y tema claro.
- RF-245: Mi día ordena y agrupa las tareas como en el alcance 5 y muestra el avance del día.
- RF-246: La ficha muestra el camino de etapas con la etapa actual marcada; una oportunidad cerrada muestra el cierre como ganado o perdido.
- RF-247: Al completar la última tarea abierta de una oportunidad abierta se ofrece crear la siguiente.
- RF-248: Cada cambio de marca queda en auditoría con quién y cuándo.
- RF-249: El diseño cumple contraste AA en los dos temas para texto normal.

## Criterios de aceptación

- AC-240 (RF-240): Dado un asesor, cuando abre "Configuración › Marca" o intenta cambiar la marca llamando directo a la base de datos o al almacenamiento, entonces se rechaza.
- AC-241 (RF-241): Dadas dos agencias con colores y logos distintos, cuando un usuario que pertenece a ambas cambia de agencia activa, entonces el logo y los colores cambian a los de la nueva agencia.
- AC-242 (RF-242): Dado un administrador que sube un archivo de 2 MB o un PDF como logo, entonces se rechaza con un mensaje claro y los colores escritos en el formulario no se pierden.
- AC-243 (RF-242): Dado un color principal muy claro (por ejemplo `#F5F5F5`), cuando se guarda, entonces aparece el aviso de contraste con un tono sugerido.
- AC-244 (RF-243, RF-244): Dado un usuario nuevo, cuando entra, entonces ve el menú arriba y el tema claro; cuando elige "A la izquierda" y "Oscuro" y vuelve a entrar desde otro navegador, entonces conserva esa elección.
- AC-245 (RF-243): Dado el menú a la izquierda, cuando el usuario lo comprime, entonces solo se ven el logo y los íconos, y al pasar el mouse sobre un ícono aparece su nombre.
- AC-246 (RF-243): Dado el tema "Automático" y un equipo en modo oscuro, cuando el usuario entra, entonces la app se ve en oscuro sin mostrar antes la versión clara.
- AC-247 (RF-245): Dadas 2 tareas vencidas y 3 de hoy, cuando el asesor abre Mi día, entonces ve primero el grupo "Vencidas" con las 2, luego "Para hoy" con las 3, y el paso 1 del plan marcado como actual.
- AC-248 (RF-246): Dada una oportunidad en la tercera etapa activa, cuando se abre su ficha, entonces las dos primeras etapas salen como hechas, la tercera como "Estás aquí" y las demás pendientes.
- AC-249 (RF-247): Dada una oportunidad abierta con una sola tarea abierta, cuando el asesor la completa, entonces se ofrece crear la siguiente; si la omite, la oportunidad aparece en "Sin siguiente paso" de Mi día.
- AC-250 (RF-248): Dado un cambio de color, entonces la auditoría muestra quién lo hizo, cuándo y el valor anterior y el nuevo.
- AC-251 (RF-249): Dadas las pantallas clave en tema claro y oscuro con las dos marcas de ejemplo, cuando se revisan con una herramienta de contraste, entonces el texto normal cumple AA.
- AC-252 (alcance 7): Dada una pantalla de 390 px de ancho, entonces no hay desplazamiento horizontal de la página y el menú se abre como cajón.

## Datos (propuesta)

- `agency_branding` (una fila por agencia, con `agency_id`, RLS como `agency_settings`): `primary_color`, `accent_color`, `logo_path`, `updated_by`, `updated_at`.
- Bucket privado `branding` en Supabase Storage, carpeta por `agency_id`; solo el administrador de esa agencia sube o borra.
- `user_preferences` (una fila por usuario, solo el propio usuario la lee y la cambia): `nav_layout` (`top`|`side`, por defecto `top`), `nav_collapsed` (por defecto falso), `theme` (`light`|`dark`|`system`, por defecto `light`).
- Migración solo aditiva (tablas nuevas); no toca datos existentes.

## Decisiones tomadas por defecto (cambiables)

- Las metas por etapa del tablero salen de un texto corto opcional por etapa que el administrador escribe en "Etapas del embudo"; si está vacío, no se muestra.
- La preferencia del menú vale para todas las agencias del usuario, no una por agencia.
- Mientras la agencia no suba un logo, se muestran sus iniciales sobre el color principal.

## Preguntas para Felipe

1. **Lista "Qué hacer ahora" por etapa** (por ejemplo, en Calificar: confirmar fechas, número de viajeros, presupuesto), con el botón para pasar de etapa que se activa al completarla. Es funcionalidad nueva, no solo diseño. ¿La incluimos en esta etapa (suma unos días) o la dejamos como siguiente paso? Recomendación: dejarla para después, y en esta etapa mostrar solo la próxima acción.
2. ¿El paso a etapa debe quedar **bloqueado** hasta completar la lista, o solo avisar? Recomendación: solo avisar, para no frenar al asesor en el piloto.

## Trazabilidad

- Tareas del tablero: T-061 (propuesta, hecha), T-062 (elección, hecha), T-063 (esta spec), T-064 (implementación), T-065 (prueba independiente con otro modelo), T-066 (revisión de Felipe en la vista previa).
- Depende de S02 y S02b (pantallas existentes y próxima acción).
