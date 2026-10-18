# CRM Viajes

CRM SaaS para agencias de viajes: contactos, oportunidades, cotizaciones y, más adelante, reservas, cobros, web y circuitos. Hecho con Next.js y TypeScript bajo Spec Driven Development.

## Estado

Fase A MVP piloto. Ver `project-status.md` y `docs/product/roadmap.md`.

## Documentos

| Documento | Para qué |
| --- | --- |
| `AGENTS.md` | Reglas para la IA que desarrolla |
| `docs/product/constitution.md` | Principios no negociables |
| `docs/product/product-brief.md` | Problema, cliente y alcance |
| `docs/product/roadmap.md` | Fases, sprints y puertas |
| `docs/product/glossary.md` | Significado de los términos |
| `docs/adr/` | Decisiones técnicas |
| `specs/` | Especificación por funcionalidad |
| `project-status.md` | Hecho, pendiente y bloqueos |
| `CHANGELOG.md` | Cambios observables |
| `docs/operations/instalacion.md` | Instalación, despliegue y pruebas |

## Arrancar

```bash
npm install
cp .env.example .env.local   # completa las claves de Supabase
DATABASE_URL="<conexión directa>" npm run db:migrate
npm run dev
```

Guía completa, despliegue en Vercel y pruebas: `docs/operations/instalacion.md`.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/app` | Pantallas y Server Actions (Next.js App Router) |
| `src/domain` | Reglas de negocio puras, sin base de datos ni React |
| `src/server` | Casos de uso que usan la base de datos |
| `src/db` | Conexión, `withUser` (RLS) y tipos del esquema |
| `supabase/migrations` | Migraciones SQL, fuente de verdad del esquema y de RLS |
| `tests/unit`, `tests/integration` | Pruebas |
