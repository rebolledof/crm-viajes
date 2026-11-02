# Plan técnico SPEC-002c

## Datos

Una migración nueva y aditiva: `20261104000000_diseno_marca.sql`. No toca datos existentes.

| Tabla | Contenido | Reglas clave |
| --- | --- | --- |
| `agency_branding` | color principal, color de acento, logo (bytes) y su tipo, quién y cuándo | una fila por agencia; todos los miembros leen; solo admin inserta o actualiza (RLS) y `updated_by` debe ser quien escribe; `check` de formato `#RRGGBB`, logo de hasta 512 KB y tipo PNG, WebP o JPEG |
| `user_preferences` | menú arriba o a la izquierda, comprimido, tema | una fila por usuario; solo el propio usuario la lee y la cambia (RLS por `auth.uid()`). No lleva `agency_id` porque la preferencia vale en todas sus agencias: es la única excepción en `tests/integration/schema.test.ts` |
| `pipeline_stages.goal` | meta corta de la etapa (hasta 120) | la cambia quien ya puede editar etapas |

El logo va en la base y no en Supabase Storage: queda bajo la misma RLS, se prueba en PostgreSQL local y se sirve por `/app/marca/logo` con la sesión, con `nosniff` y `Content-Security-Policy: default-src 'none'`. El tipo se reconoce por los bytes (`sniffLogoType`); SVG se rechaza porque puede llevar código.

## Marca y tema sin parpadeo

- `brandCssVars` (dominio puro) calcula las variables de cada tema: el texto de marca se oscurece o aclara hasta cumplir 4.5:1 sobre la tarjeta y sobre la etiqueta suave; el texto sobre botones es blanco u oscuro según el fondo.
- `src/app/app/layout.tsx` lee en el servidor la marca de la agencia activa (de la sesión) y las preferencias, escribe un `<style>` con las variables y pone la clase `dark` o `theme-system` en el contenedor. Así la primera pintura ya sale con el tema y los colores correctos.
- `globals.css` mapea las variables a utilidades de Tailwind (`bg-brand`, `text-brand-text`, `bg-accent`...) y redefine la paleta `slate` y los colores de estado en oscuro, para que las pantallas existentes funcionen en los dos temas sin reescribirlas.

## Guía paso a paso

- `src/domain/guide.ts`: `dayPlan` (los 4 pasos del día), `stagePath` (camino de etapas con el cierre) y `nextStepStatus` (estado del siguiente paso de un contacto).
- `completeTask` devuelve `needsNextStep` cuando la oportunidad sigue abierta y se quedó sin tareas; la acción lleva a la ficha con `?siguiente=1#siguiente-paso`, donde aparece el formulario "¿Cuál es el siguiente paso?". Si se omite, la oportunidad sale en "Sin siguiente paso" de Mi día.
- `myDay` agrega la etapa de cada tarea y las completadas hoy; `dueTodayCount` alimenta el número del menú; `listContacts` agrega la próxima tarea y la etapa del viaje en curso.

## Pantallas

- Menú: `shell/nav-links.tsx` (pestañas, lateral con tooltips al comprimir, cajón del celular, menú desplegable que se cierra al hacer clic fuera, con Escape o al navegar).
- Mi día, ficha de oportunidad, ficha de contacto, tablero, lista de contactos, etapas (meta), Marca de la agencia (`/app/configuracion/marca`, con vista previa en vivo) y encabezado común (`PageHeader`) en las demás. Login, registro y recuperar contraseña usan una tarjeta con los colores de fábrica.

## Cómo se revisó

- Pruebas unitarias (`tests/unit/diseno.test.ts`) e integración (`tests/integration/diseno.test.ts`).
- Capturas con Playwright en claro y oscuro, menú arriba y lateral comprimido, 1440 y 390 px, con dos marcas (Andes Travel #0F6E6E y Caribe Sol #C2185B).
- axe-core (regla `color-contrast`) en las pantallas clave, en los dos temas y con las dos marcas: 0 fallas.
- Ancho de 390 px: ninguna pantalla desborda horizontalmente (`scrollWidth` igual al ancho de la ventana).
