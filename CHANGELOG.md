# Registro de cambios

## [Sin publicar]

### Añadido

- Documentación base: constitución, resumen de producto, roadmap, glosario y AGENTS.md.
- SPEC-000 MVP piloto con los problemas que nombró la agencia piloto; ADR 0001 del stack aceptado.
- Proyecto Next.js 16.3 con TypeScript estricto, Tailwind y Supabase Auth.
- Migración base: agencias, membresías con roles (admin, asesor, lectura), invitaciones con vencimiento de 7 días y auditoría, todo con RLS por agencia.
- Pantallas: login, registro, confirmación de correo, crear agencia, cambiar de agencia, equipo (invitar, cambiar rol, quitar acceso), aceptar invitación y auditoría.
- Pruebas unitarias e integración contra PostgreSQL real; CI en GitHub Actions.
