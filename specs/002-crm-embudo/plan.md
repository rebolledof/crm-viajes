# Plan técnico SPEC-002

## Datos (migración nueva `20261102000000_crm_embudo.sql`)

Todas las tablas llevan `agency_id`, RLS activo y privilegios mínimos, igual que la base de S01.

| Tabla | Contenido | Reglas clave |
| --- | --- | --- |
| `contacts` | nombre, idioma, ciudad, etiquetas (`text[]`), responsable, origen, notas internas | responsable debe ser miembro activo |
| `contact_phones` | `e164`, etiqueta, preferido | único `(agency_id, e164)`; un preferido por contacto |
| `contact_emails` | correo en minúsculas, preferido | único `(agency_id, email)`; un preferido por contacto |
| `contact_consents` | canal, finalidad, estado, origen, actor, fecha | solo inserción; el estado vigente es el último registro |
| `opportunities` | contacto, origen, responsable, etapa, destino, producto, fechas o flexibilidad, viajeros, presupuesto `numeric(14,2)` + moneda, prioridad, observaciones, motivo y nota de pérdida, evidencia de ganado | `check` presupuesto y moneda juntos; `check` perdido con motivo; `check` ganado con evidencia |
| `tasks` | oportunidad o contacto, tipo, responsable, vence, prioridad, estado, resultado | `check` completada con resultado |
| `activities` | historial de la ficha (tipo, datos, actor, fecha) | solo inserción |

Etapas, motivos de pérdida, tipos de tarea, canales y finalidades como `enum` de PostgreSQL. Lectura solo `select`; admin y asesor `insert`/`update`. Ninguna tabla permite `delete` desde la aplicación en S02.

## Código

- `src/domain/phone.ts`: normalización con `libphonenumber-js` (Colombia por defecto).
- `src/domain/pipeline.ts`: etapas, transiciones, validación de cierre y reapertura.
- `src/domain/money.ts`: importe con `decimal.js` y moneda (COP 0 decimales, USD 2).
- `src/domain/whatsapp.ts`: enlace `https://wa.me/<número>?text=<mensaje>` y plantilla.
- `src/server/contacts.ts`, `opportunities.ts`, `tasks.ts`: casos de uso dentro de `withUser`, con `requirePermission` y `recordAudit`.
- `src/app/app/contactos`, `oportunidades` (tablero y lista), `oportunidades/[id]` (ficha), `mi-dia`.

## Pruebas

- Unitarias: teléfono, dinero, transiciones de etapa, plantilla de WhatsApp.
- Integración (PostgreSQL real): aislamiento A/B en cada tabla nueva, lectura no escribe, duplicados por teléfono y correo, `check` de cierre y presupuesto, tarea completada sin resultado, consentimiento retirado, auditoría de cambio de etapa, asignación a no miembro.
