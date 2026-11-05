# Tareas SPEC-004

- [x] T-081 Propuesta, imágenes y spec; aprobada por Felipe el 5 nov 2026 con las decisiones por defecto
- [ ] T-023 Cotización con ítems, moneda, decimales exactos y margen interno (partes 1 y 2 hechas: datos, cálculo y pantalla de 3 pasos; falta enviar en la parte 3)
- [x] T-022 Catálogo simple: tabla, permisos, pantalla del administrador y "Agregar del catálogo" (parte 2, 5 nov 2026)
- [ ] T-024 Versiones inmutables al enviar (parte 1: reglas en la base; falta enviar desde la pantalla en la parte 3)
- [ ] T-025 PDF con la marca de la agencia y sin costes internos (parte 4)
- [x] T-082 Prueba independiente de la parte 1 con otro modelo (Claude Sonnet 5.5, 5 nov 2026): 1 alto, 3 medios y 6 bajos. Corregidos con prueba: A1 (ítem en una versión que se envía a la vez), M1 (tipo de cambio visible para Lectura, ahora en `quote_version_costs`), M2 (borrar un borrador con ítems), M3 (dos nuevas versiones a la vez), B1 (sustituida sin otra enviada), B2 (servicio de catálogo de otra agencia), B3 (borrar la única versión), B6 (importe demasiado grande). Quedan: B4 ("10.005" en USD es ambiguo; la pantalla de la parte 2 mostrará el importe entendido) y B5 (permisos de funciones `app.*`: patrón existente, cubierto por las pruebas de formulario y chat).
- [x] T-083 Prueba independiente de la parte 2 con otro modelo (Claude Sonnet 5.5, 5 nov 2026): 0 altos, 2 medios y 6 bajos. Corregidos: lo escrito se perdía sin aviso al salir (ahora pregunta), "Servicios" e indicador de pasos bloqueados por la validación del navegador (ahora guardan y el servidor resalta el campo), dos pestañas que se pisaban (bloqueo de la versión, con prueba), doble clic en "Nueva cotización" o en los pasos, foco perdido al quitar un servicio, y prueba explícita de AC-413. Anotados: en el celular el paso 3 se alcanza pasando por el 2; las pruebas de pantalla (resaltado, 375 px, teclado) son manuales con Playwright.
- [ ] T-026 Felipe reproduce una cotización real de la agencia
