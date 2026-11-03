# AGENTS.md

Reglas que toda IA debe leer antes de cambiar este repositorio.

## Contexto

CRM SaaS para agencias de viajes (React, Next.js y TypeScript). El dueño del producto es Felipe, que trabaja solo con 6 horas por semana; la IA escribe el código y Felipe decide, revisa y prueba. La fase vigente es **A MVP piloto** (ver `docs/product/roadmap.md`).

## Antes de empezar

1. Lee `docs/product/constitution.md`, `project-status.md` y la especificación de la tarea en `specs/`.
2. Revisa el código y las pruebas existentes de lo que vas a tocar.
3. Trabaja solo en la siguiente tarea lista de la fase vigente. No amplíes el alcance porque una mejora parezca atractiva.

## Forma de trabajo (Spec Driven Development)

- Ninguna funcionalidad se implementa sin `spec.md` con criterios Dado-Cuando-Entonces.
- Si hay una incógnita bloqueante sobre dinero, identidad, condiciones comerciales o acceso externo, formula una pregunta concreta y avanza solo en lo independiente.
- Cada cambio funcional incluye pruebas unitarias, regresión e integración cuando aplique, y documentación actualizada.
- Para un defecto, primero escribe la prueba que lo reproduce.
- Ejecuta las pruebas y guarda el resultado. No afirmes que pasaron si no las ejecutaste. No borres pruebas ni bajes umbrales.

## Reglas técnicas no negociables

- Toda tabla de negocio lleva `agency_id`. La agencia sale de la sesión verificada, nunca de un valor enviado por el cliente.
- Autorización en servidor en cada operación (Server Actions y Route Handlers). Ocultar un botón no protege nada.
- RLS de PostgreSQL activo como segunda barrera; la aplicación no usa la clave de servicio salvo en tareas administrativas documentadas.
- Dinero con decimales exactos y moneda en cada importe; nunca coma flotante binaria.
- Un modelo de IA nunca decide precios, pagos ni confirmaciones.
- Cotizaciones enviadas son inmutables: un cambio crea una versión nueva.
- Datos sintéticos en desarrollo; nunca claves, documentos personales ni datos reales en el repositorio.
- No conectes cuentas reales, no envíes mensajes reales desde pruebas y no ejecutes migraciones destructivas sin autorización de Felipe.

## Comandos

`npm run lint`, `npm run typecheck`, `npm test` (unitarias), `npm run test:integration` (necesita PostgreSQL local, ver `docs/operations/instalacion.md`), `npm run build`. Todos deben pasar antes de abrir un PR.

## Estructura y convenciones

- `src/domain`: reglas puras con pruebas unitarias. `src/server`: casos de uso que reciben una transacción `Tx`. `src/app`: pantallas y Server Actions.
- Toda consulta de usuario va dentro de `withUser(getDb(), user, tx => ...)`. Nunca consultes con `getDb()` directamente en una petición de usuario.
- Un cambio de esquema es una migración nueva en `supabase/migrations/` (nunca edites una ya aplicada) más el ajuste de `src/db/schema.ts`.
- Cada tabla nueva lleva `agency_id`, RLS y pruebas de acceso cruzado en `tests/integration`.
- Textos de la interfaz en español.

## Al terminar cada sesión

Actualiza spec, plan y tasks afectados; esquema y migraciones; ADR si hubo una decisión duradera; `CHANGELOG.md` y `project-status.md`. Informa qué cambió, cómo se probó, qué quedó pendiente y cuál es el siguiente paso.
