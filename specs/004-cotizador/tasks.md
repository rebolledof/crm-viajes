# Tareas SPEC-004

- [x] T-081 Propuesta, imágenes y spec; aprobada por Felipe el 5 nov 2026 con las decisiones por defecto
- [ ] T-023 Cotización con ítems, moneda, decimales exactos y margen interno (parte 1 hecha: datos, cálculo, reglas y casos de uso; falta la pantalla en la parte 2)
- [ ] T-022 Catálogo simple (parte 1: tabla y permisos; falta la pantalla en la parte 2)
- [ ] T-024 Versiones inmutables al enviar (parte 1: reglas en la base; falta enviar desde la pantalla en la parte 3)
- [ ] T-025 PDF con la marca de la agencia y sin costes internos (parte 4)
- [x] T-082 Prueba independiente de la parte 1 con otro modelo (Claude Sonnet 5.5, 5 nov 2026): 1 alto, 3 medios y 6 bajos. Corregidos con prueba: A1 (ítem en una versión que se envía a la vez), M1 (tipo de cambio visible para Lectura, ahora en `quote_version_costs`), M2 (borrar un borrador con ítems), M3 (dos nuevas versiones a la vez), B1 (sustituida sin otra enviada), B2 (servicio de catálogo de otra agencia), B3 (borrar la única versión), B6 (importe demasiado grande). Quedan: B4 ("10.005" en USD es ambiguo; la pantalla de la parte 2 mostrará el importe entendido) y B5 (permisos de funciones `app.*`: patrón existente, cubierto por las pruebas de formulario y chat).
- [ ] T-026 Felipe reproduce una cotización real de la agencia
