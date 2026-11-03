# Estado del proyecto

Última actualización: 2 de noviembre de 2026 · Sprint S00 Arranque (19 oct a 1 nov), con S01, S02, S02b, el nuevo diseño y la parte 1 de S03 adelantados

## Hecho

- Plan acelerado y tablero de control (https://claude.ai/artifact/FQcdn8dR5iGm41nWQQVmUf).
- Documentación SDD base, SPEC-000 ajustada con la entrevista de la agencia y ADR 0001 aceptado.
- S01 en código (rama `s01-base`): Next.js 16.3, Supabase Auth, esquema de agencias, membresías, invitaciones y auditoría con RLS; pantallas de login, registro, agencia, equipo, invitación y auditoría; CI en GitHub Actions.
- S02 en código (rama `s02-crm`, sobre `s01-base`): contactos, consentimientos, embudo por agencia, oportunidades, tareas, Mi día y botón de WhatsApp (SPEC-002). Migración `20261102000000_crm_embudo.sql` aplicada solo en PostgreSQL local.
- S02b en código (rama `claude/project-thread-6eqhro`, sobre `s02-crm`): plantillas de seguimiento con tareas automáticas, horario laboral, niveles de edición y plantillas personales (SPEC-002b). Migraciones `20261103000000_tarea_whatsapp.sql` y `20261103000100_seguimientos.sql` aplicadas en PostgreSQL local y, con permiso de Felipe, en `crm-viajes-pruebas` el 1 nov 2026 (2 agencias con sus 6 plantillas). La migración de S02 `20261103000200_s02_miembro_retirado.sql` se aplicó allí el 2 nov 2026 con permiso de Felipe.
- Nuevo diseño SPEC-002c en código (rama `claude/project-thread-ss572g`, sobre la de S02b, PR #4): estilo A, marca por agencia, menú y tema por persona, plan del día, camino de etapas y "¿Cuál es el siguiente paso?". Migración `20261104000000_diseno_marca.sql` aplicada en PostgreSQL local y, con permiso de Felipe, en `crm-viajes-pruebas` el 2 nov 2026.
- S03 Bandeja, parte 1 en código (rama `claude/project-thread-3wyo62`, sobre la del diseño): SPEC-003 aprobada por Felipe el 2 nov 2026. Formulario web público por agencia (`/f/<código>`, incrustable), bandeja con dueño por conversación, alerta de "sin responder" a los 30 minutos de horario laboral, respuestas guardadas con "/", canales de entrada y paso "Responde los mensajes" en Mi día. ADR 0002 (entrada pública por funciones `app.*`). Decisiones de Felipe del 2 nov: D-14 (datos del formulario para un contacto existente quedan "sin verificar", migración `20261106000000_datos_sin_verificar.sql`, aplicada en `crm-viajes-pruebas` el 2 nov 2026 con su permiso) y D-15 (un asesor puede resolver conversaciones de otro). Migración `20261105000000_bandeja.sql` aplicada en PostgreSQL local y, con permiso de Felipe, en `crm-viajes-pruebas` el 2 nov 2026 (3 agencias con su formulario y 5 respuestas guardadas).
- S03 Bandeja, parte 2 (chat web) en código (rama `claude/project-thread-3wyo62-chat`, desde `main` tras el merge de los PRs #1 a #5 el 3 nov 2026): spec `specs/003-bandeja/spec-parte-2-chat.md` con D-16 y D-17 aprobadas por Felipe el 3 nov. Migración `20261108000000_chat_web.sql` aplicada solo en PostgreSQL local; falta el permiso de Felipe para `crm-viajes-pruebas` (que también usa producción).
- Pruebas: 14 unitarias y 21 de integración contra PostgreSQL 16 real (aislamiento A/B, roles, invitaciones vencidas, revocadas y de otro correo, membresía revocada, auditoría, coherencia del esquema).

## Comandos verificados

3 nov 2026 en la rama del chat web: lint, typecheck, 106 unitarias, 144 de integración y build sin errores. Recorrido a 375 px con datos sintéticos (capturas en `diseno/implementado/chat/`): encender el chat, primer mensaje con error que conserva lo escrito, respuesta del asesor visible en la ventana en 2 s sin recargar, Enter envía, historial al recargar, "¿Era una consulta de viaje?" y crear oportunidad, chat pausado que conserva el texto, burbuja en la página de prueba con Escape para cerrar, y escritorio.

2 nov 2026 en la rama de S03 parte 1, tras corregir la prueba independiente (Sonnet) y aplicar D-14 (con su prueba independiente): lint, typecheck, 96 unitarias, 120 de integración.

3 nov 2026, tras la prueba independiente (Sonnet) de los ajustes del informe: lint, typecheck, 96 unitarias, 126 de integración y build sin errores. La página de formulario no encontrado se comprobó con `next start` a 375 px, con y sin JavaScript. Felipe ejecutó `20261107000000_limite_ventana_movil.sql` en crm-viajes-pruebas el 3 nov 2026; la función quedó igual a la local (md5) y anon sigue con solo 3 funciones.

3 nov 2026, tras el informe de pruebas de S03 parte 1: lint, typecheck, 96 unitarias, 124 de integración y build sin errores. Recorrido a 390 px (Mi día, bandeja lista y conversación, Canales, respuestas, ficha, formulario y formulario no encontrado) sin desbordes; seis envíos seguidos desde el navegador: el sexto se rechaza y conserva lo escrito y build sin errores. axe-core sin fallas en bandeja, canales, respuestas y formulario; recorrido a 375 px con capturas en `diseno/implementado/bandeja/`.

2 nov 2026 en la rama del diseño, tras corregir la prueba independiente (Sonnet): lint, typecheck, 78 unitarias, 98 de integración y build sin errores. axe-core sin fallas de contraste en las pantallas clave (claro y oscuro, dos marcas) y ninguna pantalla desborda a 390 px.

2 nov 2026 en la rama de S02b, tras corregir el informe de QA y traer `s02-crm` (d76952e): lint, typecheck, 54 unitarias, 78 de integración y build sin errores; prueba independiente con otro modelo (Sonnet) sin defectos altos ni medios, y sus dos sugerencias aplicadas con prueba. Los avisos de validación en español se comprobaron con Chromium en inglés sobre /registro.

1 nov 2026 en la rama de S02b: lint, typecheck, 40 unitarias, 68 de integración y build sin errores. Prueba independiente con otro modelo (Sonnet) hecha; hallazgos corregidos con prueba.

19 oct 2026 en `s02-crm`: lint, typecheck, 33 unitarias, 45 de integración y build sin errores.

18 oct 2026 en `s01-base`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`: todos sin errores. `next start` sirve /login (200) y redirige /app a /login sin sesión.

## Verificado manualmente

- 2 y 3 nov 2026, QA en la vista previa del PR #5 (informe final de S03 parte 1): cumplen AC-261, 263 a 273, 275, 276, D-15, formulario pausado, tema oscuro y regresión de S02/S02b. Fallaron AC-274 (el sexto envío pasaba) y AC-262 (404 en inglés); ambos corregidos el 3 nov con prueba. La inyección de agency_id en el cuerpo y la vista a 390 px, que QA no pudo probar, quedaron cubiertas con prueba automática y recorrido local.

- 1 y 2 nov 2026, QA con IA en la vista previa del PR #3: S02 y S02b cumplen salvo F-01 (faltaba la lista con búsqueda de oportunidades) y tres mejoras de usabilidad; las cuatro se corrigieron el 2 nov (T-060). No se probaron en el navegador AC-201, AC-202 ni el ingreso de un usuario inactivo (están cubiertos por pruebas de integración). QA dejó activadas las plantillas propias de asesores en su agencia de prueba.
- 19 oct 2026, Felipe en la vista previa de Vercel contra `crm-viajes-pruebas`: registro, confirmación de correo, creación de agencia y aceptación de invitación.

## No verificado todavía

- La bandeja en la vista previa de Vercel: la migración ya está en `crm-viajes-pruebas`; falta que Felipe la recorra (T-032).
- Respuestas por WhatsApp y correo: en la parte 1 se abren con wa.me o mailto; el chat web (T-027b) y el correo de entrada (T-028, adaptador simulado) siguen pendientes.

- El diseño nuevo en la vista previa de Vercel: la migración ya está en `crm-viajes-pruebas`; falta que Felipe lo recorra (T-066).

- Las correcciones del 2 nov (lista de oportunidades, botones deshabilitados, auditoría legible) en la vista previa: tienen pruebas, falta recorrerlas en el navegador.
- Recorrido E2E con Playwright: necesita Supabase Auth local o de pruebas; queda para S05.

## Pendiente

- Antes del piloto: conectar un servicio de correo propio (SMTP) en Supabase; el correo incluido solo envía unos 2 por hora y bloqueó el registro y la recuperación de contraseña el 31 oct.
- Antes del piloto con datos reales: pasar Supabase y Vercel a planes Pro (el plan Hobby de Vercel no permite uso comercial y el gratuito de Supabase no tiene copias).
- Felipe: iniciar la verificación de Meta Business (ahora es crítica para la bandeja).
- Felipe: canales que usa la agencia, volumen de mensajes y dirección de su web.
- Felipe: confirmar el horario de la agencia piloto (se supuso lunes a viernes 8 a 18 y sábado 8 a 12) y si se descuentan festivos.
- Regla del 1 nov 2026: cada cambio terminado lo prueba otro agente con un modelo distinto antes del merge, y después se actualiza el tablero del plan.
- Felipe: confirmar qué cuenta como evidencia de ganado (por ahora, texto libre obligatorio).
- Felipe: cambiar la contraseña de la base de pruebas, que se compartió en el chat.

## Bloqueos

Ninguno de código. La política de datos personales bloquea cargar datos reales en S05.

## Siguiente tarea

Revisión de Felipe en la vista previa (T-032, con T-066, T-021 y T-059). Después, parte 2: chat web (T-027b).
