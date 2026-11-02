# Estado del proyecto

Última actualización: 2 de noviembre de 2026 · Sprint S00 Arranque (19 oct a 1 nov), con S01, S02 y S02b adelantados

## Hecho

- Plan acelerado y tablero de control (https://claude.ai/artifact/FQcdn8dR5iGm41nWQQVmUf).
- Documentación SDD base, SPEC-000 ajustada con la entrevista de la agencia y ADR 0001 aceptado.
- S01 en código (rama `s01-base`): Next.js 16.3, Supabase Auth, esquema de agencias, membresías, invitaciones y auditoría con RLS; pantallas de login, registro, agencia, equipo, invitación y auditoría; CI en GitHub Actions.
- S02 en código (rama `s02-crm`, sobre `s01-base`): contactos, consentimientos, embudo por agencia, oportunidades, tareas, Mi día y botón de WhatsApp (SPEC-002). Migración `20261102000000_crm_embudo.sql` aplicada solo en PostgreSQL local.
- S02b en código (rama `claude/project-thread-6eqhro`, sobre `s02-crm`): plantillas de seguimiento con tareas automáticas, horario laboral, niveles de edición y plantillas personales (SPEC-002b). Migraciones `20261103000000_tarea_whatsapp.sql` y `20261103000100_seguimientos.sql` aplicadas en PostgreSQL local y, con permiso de Felipe, en `crm-viajes-pruebas` el 1 nov 2026 (2 agencias con sus 6 plantillas).
- Pruebas: 14 unitarias y 21 de integración contra PostgreSQL 16 real (aislamiento A/B, roles, invitaciones vencidas, revocadas y de otro correo, membresía revocada, auditoría, coherencia del esquema).

## Comandos verificados

2 nov 2026 en la rama de S02b, tras corregir el informe de QA y traer `s02-crm` (d76952e): lint, typecheck, 54 unitarias, 78 de integración y build sin errores; prueba independiente con otro modelo (Sonnet) sin defectos altos ni medios, y sus dos sugerencias aplicadas con prueba. Los avisos de validación en español se comprobaron con Chromium en inglés sobre /registro.

1 nov 2026 en la rama de S02b: lint, typecheck, 40 unitarias, 68 de integración y build sin errores. Prueba independiente con otro modelo (Sonnet) hecha; hallazgos corregidos con prueba.

19 oct 2026 en `s02-crm`: lint, typecheck, 33 unitarias, 45 de integración y build sin errores.

18 oct 2026 en `s01-base`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`: todos sin errores. `next start` sirve /login (200) y redirige /app a /login sin sesión.

## Verificado manualmente

- 1 y 2 nov 2026, QA con IA en la vista previa del PR #3: S02 y S02b cumplen salvo F-01 (faltaba la lista con búsqueda de oportunidades) y tres mejoras de usabilidad; las cuatro se corrigieron el 2 nov (T-060). No se probaron en el navegador AC-201, AC-202 ni el ingreso de un usuario inactivo (están cubiertos por pruebas de integración). QA dejó activadas las plantillas propias de asesores en su agencia de prueba.
- 19 oct 2026, Felipe en la vista previa de Vercel contra `crm-viajes-pruebas`: registro, confirmación de correo, creación de agencia y aceptación de invitación.

## No verificado todavía

- Las correcciones del 2 nov (lista de oportunidades, botones deshabilitados, auditoría legible) en la vista previa: tienen pruebas, falta recorrerlas en el navegador.
- Recorrido E2E con Playwright: necesita Supabase Auth local o de pruebas; queda para S05.

## Pendiente

- Aplicar en `crm-viajes-pruebas` la migración `20261103000200_s02_miembro_retirado.sql` de S02 (solo reemplaza funciones de triggers; necesita permiso de Felipe). Sin ella, la vista previa sigue con la regla anterior: no deja mover ni cerrar lo de una persona retirada.
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

Felipe prueba S02 y S02b en la vista previa (T-021 y T-059). Después, S03 Bandeja unificada.
