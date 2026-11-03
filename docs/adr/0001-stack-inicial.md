# ADR 0001: Stack inicial

- Estado: Aceptado por Felipe el 18 de octubre de 2026
- Fecha: 18 de octubre de 2026

## Contexto

Una sola persona con 6 horas por semana dirige el proyecto y la IA implementa. El briefing pide React, Next.js y TypeScript, PostgreSQL, aislamiento por agencia con RLS, autenticación probada, archivos privados y copias de seguridad. Construir y operar esas piezas por separado consumiría la mayor parte del tiempo disponible antes de entregar valor a la agencia piloto.

## Decisión

| Componente | Elección |
| --- | --- |
| Aplicación | Next.js 16.3 (App Router) con TypeScript estricto y React 19.2 |
| Base de datos | PostgreSQL administrado en Supabase |
| Acceso a datos | Drizzle ORM sobre la conexión de Supabase. Las migraciones son SQL escrito a mano en `supabase/migrations/` (fuente de verdad, incluye RLS); `src/db/schema.ts` da los tipos y una prueba verifica que coinciden |
| Autenticación | Supabase Auth (correo y contraseña, enlace mágico; MFA para administradores) |
| Aislamiento | `agency_id` en cada tabla de negocio y políticas RLS ligadas a la membresía activa. Cada consulta de usuario corre en `withUser`: transacción con rol `authenticated` y claims del JWT, así la conexión privilegiada nunca consulta sin RLS |
| Archivos | Supabase Storage privado con URLs firmadas de corta duración |
| Validación | Zod en entradas de Server Actions, Route Handlers y respuestas de IA |
| Dinero | `numeric` en PostgreSQL y decimal.js en TypeScript; importes como cadena en las APIs |
| PDF | Generación en servidor con @react-pdf/renderer |
| Correo | Resend (recordatorios y envío de cotizaciones) |
| Despliegue | Vercel para la aplicación; Supabase para datos |
| Pruebas | Vitest (unitarias e integración contra PostgreSQL 16 real con un stub del esquema `auth` de Supabase); Testing Library y Playwright cuando haya pantallas de negocio |
| CI | GitHub Actions: lint, tipos, pruebas y build en cada push |

Las colas y el proceso de trabajadores (BullMQ) quedan para la fase B, cuando lleguen los webhooks de WhatsApp. Hasta entonces bastan tareas programadas de Supabase o de Vercel.

## Versiones fijadas

Next 16.3.8 y no 16.4.x porque esta última tenía menos de dos semanas al iniciar. React 19.2.8, Drizzle 0.45.4 (corrige una inyección SQL de versiones anteriores), Vitest 4.1.11, Zod 4. `npm audit --omit=dev` sin vulnerabilidades. Queda un aviso alto en `braces`, dependencia solo de desarrollo de eslint-config-next, sin arreglo publicado. `.npmrc` usa `legacy-peer-deps` por un fallo de npm 10 al resolver los peers opcionales de Vitest.

## Consecuencias

- Login, RLS, archivos y copias vienen resueltos, lo que reduce la fase base de semanas a un sprint.
- Coste: planes gratuitos durante el desarrollo. En producción con datos reales se recomienda Supabase Pro (copias diarias) y Vercel Pro (el plan gratuito no es para uso comercial), cerca de USD 45 al mes; verificar precios vigentes al contratar.
- Dependencia de Supabase: se mitiga porque los datos están en PostgreSQL estándar, Drizzle no depende de Supabase y la autenticación se aísla detrás de un módulo propio.
- RLS debe probarse con un rol restringido; la clave de servicio no se usa en peticiones de usuario.

## Alternativas consideradas

- Prisma en lugar de Drizzle: más conocido, pero Drizzle da SQL más explícito para RLS y transacciones.
- Auth.js o Clerk: Auth.js exige más trabajo propio; Clerk añade otro proveedor de pago.
- Infraestructura propia (VPS, Postgres y Redis): más barata a escala, pero exige operación que hoy no hay tiempo de hacer.
