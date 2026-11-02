# ADR 0002 · Entrada pública de la bandeja (formulario, luego chat y correo)

- Estado: Aceptado (2 nov 2026, al implementar SPEC-003 parte 1)

## Contexto

El formulario web lo envía un visitante sin sesión. AGENTS.md exige que la agencia salga de un dato verificado, que RLS sea la segunda barrera y que la aplicación no use la clave de servicio salvo en tareas administrativas. Además, cada tarea necesita un responsable y cada contacto u oportunidad un autor (`created_by`), y no hay usuario.

## Decisión

1. La aplicación llama a la base con el rol `anon` (`withAnon`) y ese rol solo puede ejecutar tres funciones `security definer` del esquema `app`: información del formulario, logo y envío. No lee ninguna tabla.
2. Esas funciones viven en `app`, que la API REST de Supabase no expone; así nadie puede llamarlas con la clave anónima saltándose el servidor (campo trampa, validación y huella de la dirección).
3. La agencia sale del código público del canal (aleatorio, 32 caracteres), nunca de un campo del visitante. Un canal pausado rechaza.
4. Lo que crea un visitante figura como creado por el administrador activo más antiguo de la agencia, que recibe las tareas automáticas hasta que alguien toma la conversación. El historial dice que llegó por el formulario.
5. Límite de envíos en la base (`app.inbound_rate`): 5 cada 10 minutos por huella de dirección y formulario; 200 por agencia.

## Consecuencias

- Sin clave de servicio en la aplicación y sin tablas legibles por `anon`; probado en `tests/integration/bandeja.test.ts`.
- El chat (parte 2) y el webhook de correo (parte 3) usarán el mismo patrón: función de entrada en `app`, agencia desde el canal, `anon` sin acceso a tablas. El webhook además valida la firma del proveedor.
- Si el administrador más antiguo se retira, toma su lugar el siguiente; si la agencia no tiene administradores activos, el formulario rechaza los envíos.
