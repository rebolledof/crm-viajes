# Estado del proyecto

Última actualización: 19 de octubre de 2026 · Sprint S00 Arranque (19 oct a 1 nov), con S01 y S02 adelantados

## Hecho

- Plan acelerado y tablero de control (https://claude.ai/artifact/FQcdn8dR5iGm41nWQQVmUf).
- Documentación SDD base, SPEC-000 ajustada con la entrevista de la agencia y ADR 0001 aceptado.
- S01 en código (rama `s01-base`): Next.js 16.3, Supabase Auth, esquema de agencias, membresías, invitaciones y auditoría con RLS; pantallas de login, registro, agencia, equipo, invitación y auditoría; CI en GitHub Actions.
- S02 en código (rama `s02-crm`, sobre `s01-base`): contactos, consentimientos, embudo por agencia, oportunidades, tareas, Mi día y botón de WhatsApp (SPEC-002). Migración `20261102000000_crm_embudo.sql` aplicada solo en PostgreSQL local.
- Pruebas: 14 unitarias y 21 de integración contra PostgreSQL 16 real (aislamiento A/B, roles, invitaciones vencidas, revocadas y de otro correo, membresía revocada, auditoría, coherencia del esquema).

## Comandos verificados

19 oct 2026 en `s02-crm`: lint, typecheck, 33 unitarias, 45 de integración y build sin errores.

18 oct 2026 en `s01-base`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`: todos sin errores. `next start` sirve /login (200) y redirige /app a /login sin sesión.

## Verificado manualmente

- 19 oct 2026, Felipe en la vista previa de Vercel contra `crm-viajes-pruebas`: registro, confirmación de correo, creación de agencia y aceptación de invitación.

## No verificado todavía

- Pantallas de S02 en un navegador: compilan, pero nadie las ha recorrido; hace falta aplicar la migración en `crm-viajes-pruebas` (con permiso de Felipe) y probar en la vista previa.
- Recorrido E2E con Playwright: necesita Supabase Auth local o de pruebas; queda para S05.

## Pendiente

- Antes del piloto con datos reales: pasar Supabase y Vercel a planes Pro (el plan Hobby de Vercel no permite uso comercial y el gratuito de Supabase no tiene copias).
- Felipe: iniciar la verificación de Meta Business (ahora es crítica para la bandeja).
- Felipe: canales que usa la agencia, volumen de mensajes y dirección de su web.
- Felipe: confirmar qué cuenta como evidencia de ganado (por ahora, texto libre obligatorio).
- Felipe: cambiar la contraseña de la base de pruebas, que se compartió en el chat.

## Bloqueos

Ninguno de código. La política de datos personales bloquea cargar datos reales en S05.

## Siguiente tarea

Felipe prueba S02 en la vista previa (T-021 demo a la agencia). Después, S03 Bandeja unificada.
