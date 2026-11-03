# Instalación y puesta en marcha

## Requisitos

- Node.js 22 o superior.
- Una cuenta de Supabase y una de Vercel.
- Para las pruebas de integración: PostgreSQL 16 local (o Docker).

## 1. Proyecto en Supabase

1. Crea un proyecto nuevo (región recomendada: `us-east-1` o São Paulo, la más cercana a Colombia).
2. En **Project Settings → API** copia la URL del proyecto y la clave `anon` (o `publishable`).
3. En **Project Settings → Database → Connection string** copia:
   - la conexión **directa** (puerto 5432) para migraciones;
   - el **pooler en modo transacción** (puerto 6543) para la aplicación.
4. En **Authentication → URL Configuration** pon como *Site URL* la dirección de la app (por ejemplo `https://crm-viajes.vercel.app`) y agrega `http://localhost:3000/**` en *Redirect URLs* para desarrollo.

## 2. Variables de entorno

Copia `.env.example` a `.env.local` y complétalo. Nunca subas `.env.local` al repositorio.

## 3. Migraciones

```bash
npm install
DATABASE_URL="<conexión directa 5432>" npm run db:migrate
```

El comando aplica en orden los archivos de `supabase/migrations/` que falten y los registra en `app.schema_migrations`. Ejecutarlo dos veces no repite nada.

## 4. Desarrollo local

```bash
npm run dev
```

Abre http://localhost:3000, crea una cuenta, confirma el correo y crea tu agencia.

## 5. Despliegue en Vercel

1. Importa el repositorio en Vercel.
2. Configura las variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL` (pooler 6543) y `NEXT_PUBLIC_SITE_URL`.
3. Cada push a `main` despliega producción; cada PR crea una vista previa.

## Pruebas

```bash
npm run lint        # estilo
npm run typecheck   # tipos
npm test            # unitarias
npm run test:integration   # aislamiento y RLS contra PostgreSQL real
```

Las pruebas de integración crean y borran la base `crm_viajes_test` usando `DATABASE_URL_ADMIN` (por defecto `postgres://postgres:postgres@localhost:5432/postgres`). Se aplica `tests/integration/supabase-stub.sql`, que imita el esquema `auth` y los roles de Supabase.

Con Docker:

```bash
docker run -d --name crm-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

## Recuperación

Supabase Pro hace copias diarias y permite restaurar desde el panel. El procedimiento de restauración probada se documenta en S05 (`docs/operations/restauracion.md`).
