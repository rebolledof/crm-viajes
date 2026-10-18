# ADR 0001: Stack inicial

- Estado: Propuesto (pendiente de aprobación de Felipe)
- Fecha: 18 de octubre de 2026

## Contexto

Una sola persona con 6 horas por semana dirige el proyecto y la IA implementa. El briefing pide React, Next.js y TypeScript, PostgreSQL, aislamiento por agencia con RLS, autenticación probada, archivos privados y copias de seguridad. Construir y operar esas piezas por separado consumiría la mayor parte del tiempo disponible antes de entregar valor a la agencia piloto.

## Decisión

| Componente | Elección |
| --- | --- |
| Aplicación | Next.js (App Router) con TypeScript estricto |
| Base de datos | PostgreSQL administrado en Supabase |
| Acceso a datos | Drizzle ORM sobre la conexión de Supabase, con migraciones versionadas en el repositorio |
| Autenticación | Supabase Auth (correo y contraseña, enlace mágico; MFA para administradores) |
| Aislamiento | `agency_id` en cada tabla de negocio, claves compuestas agencia + id y políticas RLS ligadas a la membresía del usuario |
| Archivos | Supabase Storage privado con URLs firmadas de corta duración |
| Validación | Zod en entradas de Server Actions, Route Handlers y respuestas de IA |
| Dinero | `numeric` en PostgreSQL y decimal.js en TypeScript; importes como cadena en las APIs |
| PDF | Generación en servidor con @react-pdf/renderer |
| Correo | Resend (recordatorios y envío de cotizaciones) |
| Despliegue | Vercel para la aplicación; Supabase para datos |
| Pruebas | Vitest, Testing Library y Playwright; Supabase local para integración |
| CI | GitHub Actions: lint, tipos, pruebas y build en cada push |

Las colas y el proceso de trabajadores (BullMQ) quedan para la fase B, cuando lleguen los webhooks de WhatsApp. Hasta entonces bastan tareas programadas de Supabase o de Vercel.

## Consecuencias

- Login, RLS, archivos y copias vienen resueltos, lo que reduce la fase base de semanas a un sprint.
- Coste: planes gratuitos durante el desarrollo. En producción con datos reales se recomienda Supabase Pro (copias diarias) y Vercel Pro (el plan gratuito no es para uso comercial), cerca de USD 45 al mes; verificar precios vigentes al contratar.
- Dependencia de Supabase: se mitiga porque los datos están en PostgreSQL estándar, Drizzle no depende de Supabase y la autenticación se aísla detrás de un módulo propio.
- RLS debe probarse con un rol restringido; la clave de servicio no se usa en peticiones de usuario.

## Alternativas consideradas

- Prisma en lugar de Drizzle: más conocido, pero Drizzle da SQL más explícito para RLS y transacciones.
- Auth.js o Clerk: Auth.js exige más trabajo propio; Clerk añade otro proveedor de pago.
- Infraestructura propia (VPS, Postgres y Redis): más barata a escala, pero exige operación que hoy no hay tiempo de hacer.
