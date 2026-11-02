# Registro de cambios

## [Sin publicar]

### Añadido

- Documentación base: constitución, resumen de producto, roadmap, glosario y AGENTS.md.
- SPEC-000 MVP piloto con los problemas que nombró la agencia piloto; ADR 0001 del stack aceptado.
- Proyecto Next.js 16.3 con TypeScript estricto, Tailwind y Supabase Auth.
- Migración base: agencias, membresías con roles (admin, asesor, lectura), invitaciones con vencimiento de 7 días y auditoría, todo con RLS por agencia.
- Pantallas: login, registro, confirmación de correo, crear agencia, cambiar de agencia, equipo (invitar, cambiar rol, quitar acceso), aceptar invitación y auditoría.
- Pruebas unitarias e integración contra PostgreSQL real; CI en GitHub Actions.
- SPEC-002: contactos con varios teléfonos y correos normalizados, aviso de duplicados y consentimientos por canal y finalidad.
- Embudo propio de cada agencia (10 etapas iniciales que el administrador renombra, ordena, agrega o desactiva) y oportunidades que saltan a cualquier etapa activa.
- Cierre ganado con evidencia, perdido con motivo (y nota si es "otro") y reapertura con razón; todo en historial y auditoría.
- Presupuesto con importe exacto y moneda (COP o USD); campos desconocidos se muestran como "Desconocido".
- Tareas con resultado obligatorio al completar, próxima acción en el tablero y pantalla "Mi día" con la alerta "sin próxima acción".
- Una tarea creada desde la ficha del contacto queda ligada a una oportunidad (por defecto la abierta más reciente), para que cuente como su próxima acción.
- Módulo de Tareas: todas las tareas de la agencia agrupadas en vencidas, hoy y próximas, con filtros por responsable, estado y tipo (RF-218).
- Mi día muestra también las próximas tareas, no solo las de hoy y vencidas.
- Los formularios conservan lo escrito cuando hay un error y resaltan el campo con el problema (contactos, oportunidades, tareas, etapas, consentimiento, agencia, invitaciones, login y registro).
- Regla de usabilidad en AGENTS.md: lista que se revisa en cada pantalla.
- Recuperar contraseña: enlace "Olvidé mi contraseña" en el login, correo con enlace y pantalla para elegir la nueva.
- El login avisa cuando falta confirmar el correo.
- La pantalla de registro explica el motivo cuando Supabase rechaza la cuenta (límite de correos, contraseña débil, correo existente).
- Botón de WhatsApp con mensaje prellenado y editable que respeta el consentimiento y queda en la ficha.
- Regla de prueba independiente en AGENTS.md: otro agente con un modelo distinto prueba cada cambio antes del merge y luego se actualiza el tablero.
- La búsqueda de contactos encuentra por parte del teléfono (desde 4 dígitos).
- La auditoría muestra en español los eventos de contactos, oportunidades, etapas y tareas, con "de etapa a etapa" y la razón.
- Los campos obligatorios llevan un asterisco rojo.

### Corregido (prueba independiente de S02, 1 nov 2026)

- Las tareas, oportunidades y contactos de una persona retirada de la agencia ya se pueden completar, cancelar, mover y editar; antes daban error. Asignarle algo nuevo sigue prohibido (migración 20261103000200).
- Un parámetro repetido en la URL (?q=a&q=b) ya no rompe las listas.
- Un identificador alterado en un formulario o en la URL responde "no encontrado" en vez de un error interno.
- Una tarea con una oportunidad de otro contacto muestra un mensaje claro; WhatsApp ya no registra el mensaje en una oportunidad de otro contacto.
- Una fecha que no existe (30 de febrero) se rechaza en vez de correrse al mes siguiente.
- Al editar, un responsable que ya no está en la agencia se conserva en vez de borrarse.
- El campo de viajeros acepta hasta 999, igual que el servidor.
- Oportunidades sin resultados explica qué hacer (cambiar el filtro o crear una desde un contacto).
