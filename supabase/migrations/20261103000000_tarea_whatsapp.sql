-- SPEC-002b · Tipo de tarea "whatsapp". Va en su propia migración porque PostgreSQL no permite
-- usar un valor nuevo de un enum en la misma transacción que lo agrega.
alter type public.task_kind add value if not exists 'whatsapp' after 'llamada';
