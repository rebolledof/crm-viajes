# Estado del proyecto

Última actualización: 18 de octubre de 2026 · Sprint S00 Arranque (19 oct a 1 nov), con S01 adelantado

## Hecho

- Plan acelerado y tablero de control (https://claude.ai/artifact/FQcdn8dR5iGm41nWQQVmUf).
- Documentación SDD base, SPEC-000 ajustada con la entrevista de la agencia y ADR 0001 aceptado.
- S01 en código (rama `s01-base`): Next.js 16.3, Supabase Auth, esquema de agencias, membresías, invitaciones y auditoría con RLS; pantallas de login, registro, agencia, equipo, invitación y auditoría; CI en GitHub Actions.
- Pruebas: 14 unitarias y 21 de integración contra PostgreSQL 16 real (aislamiento A/B, roles, invitaciones vencidas, revocadas y de otro correo, membresía revocada, auditoría, coherencia del esquema).

## Comandos verificados el 18 oct 2026

`npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`: todos sin errores. `next start` sirve /login (200) y redirige /app a /login sin sesión.

## No verificado todavía

- Login y registro contra un proyecto real de Supabase (falta conectar las claves).
- Recorrido E2E con Playwright: llega con las pantallas de negocio en S02.

## Pendiente

- Felipe: pasar las claves de Supabase a Vercel y aplicar la migración (ver `docs/operations/instalacion.md`).
- Felipe: iniciar la verificación de Meta Business (ahora es crítica para la bandeja).
- Felipe: canales que usa la agencia, volumen de mensajes y dirección de su web.

## Bloqueos

Ninguno de código. La política de datos personales bloquea cargar datos reales en S05.

## Siguiente tarea

S02: contactos, oportunidades, embudo, tareas y botón de WhatsApp.
