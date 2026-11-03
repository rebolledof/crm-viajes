# Plan técnico SPEC-002b

## Datos

Dos migraciones nuevas (ninguna destructiva):

- `20261103000000_tarea_whatsapp.sql`: agrega el tipo de tarea `whatsapp`. Va sola porque PostgreSQL no deja usar un valor nuevo de un enum en la misma transacción que lo crea.
- `20261103000100_seguimientos.sql`: lo demás.

| Tabla | Contenido | Reglas clave |
| --- | --- | --- |
| `agency_settings` | horario laboral (lunes a viernes, sábado), zona horaria, interruptor de plantillas personales | una fila por agencia; solo admin escribe |
| `followup_templates` | nombre, disparador, etapa, motivos de pérdida, etapa de parada, nivel de edición, dueño (personal) y activa | `check` etapa obligatoria solo con disparador "etapa"; RLS: personales visibles solo para su dueño y el admin |
| `followup_steps` | tipo, título, espera (cantidad + unidad), hora fija, prioridad, mensaje, bloqueado | se pueden borrar; `on delete set null` en `tasks.step_id` |
| `tasks` (+5 columnas) | `template_id`, `step_id`, `trigger_stage_id`, `message`, `edit_level` | las tareas manuales quedan con todo en `null` y se comportan como libres |

## Motor en la base

- `app.followup_due(desde, cantidad, unidad, hora, agencia)`: calcula el vencimiento en hora local con `app.next_open` (primer instante laborable). Minutos y días calendario se corren al siguiente instante laborable; horas hábiles se consumen solo dentro del horario; días hábiles saltan domingos (y sábados si no se trabajan).
- Trigger `opportunities_followups` (after insert or update, security definer): reasigna las automáticas al cambiar el responsable, cancela según la regla de parada y cierre, y crea las tareas de las plantillas que aplican. Deja historial (`seguimiento.creado`, `seguimiento.cancelado`) y auditoría.
- Trigger `tasks_edit_guard` (before update, con los privilegios de quien llama): si el usuario es asesor, rechaza con `task_locked` lo que el nivel no permite. El motor no pasa por la regla porque corre como dueño de la función.
- Por qué en la base y no en el servidor: la importación CSV (S05), el formulario web y la bandeja (S03) también crean oportunidades; así todas aplican las mismas reglas sin código extra.

## Código

- `src/domain/followups.ts`: textos, `describeDelay`, `taskPermissions(rol, nivel)`, `fillMessage`, `mailtoLink`.
- `src/server/followups.ts`: ajustes, plantillas y pasos con validación y auditoría.
- `src/server/tasks.ts`: `updateTask` (fecha, prioridad, mensaje, asignada), `cancelTask` con nivel y `openTaskLink` (WhatsApp o correo con el mensaje relleno y consentimiento).
- Pantallas: `/app/seguimientos` (lista, horario y permisos), `/app/seguimientos/nueva`, `/app/seguimientos/[id]` (pasos y configuración). `TaskItem` muestra la marca "Automática", el mensaje, "Abrir WhatsApp/correo con el mensaje" y "Ajustar" según el nivel.

## Pruebas

- Unitarias (`tests/unit/followups.test.ts`): espera, permisos por nivel, relleno del mensaje, enlace de correo.
- Integración (`tests/integration/followups.test.ts`): plantillas precargadas y aislamiento, horario hábil con fechas fijas, creación, parada, cierre y reapertura, filtro de motivos, no duplicar, cambio de responsable, niveles bloqueada y ajustable (servidor y base), paso bloqueado, plantillas de la agencia y personales.
