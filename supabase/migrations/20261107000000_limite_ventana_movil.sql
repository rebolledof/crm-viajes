-- AC-274 (informe de pruebas del 3 nov 2026): el límite de envíos del formulario contaba por bloques
-- fijos de 10 minutos del reloj (10:00, 10:10…). Seis envíos en menos de 10 minutos que cruzaban el
-- cambio de bloque pasaban todos. Ahora se cuentan los envíos de los últimos 10 minutos (ventana
-- móvil). Migración aditiva: tabla nueva; app.inbound_rate queda sin uso (borrarla pide permiso).

create table app.inbound_hits (
  key text not null,
  hit_at timestamptz not null default now()
);
create index inbound_hits_key_idx on app.inbound_hits (key, hit_at);
create index inbound_hits_at_idx on app.inbound_hits (hit_at);

-- Cuenta un envío; falso (y no lo cuenta) si la clave ya tiene p_limit envíos en los últimos 10 minutos.
create or replace function app.inbound_hit(p_key text, p_limit integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_hits integer;
begin
  -- Dos envíos al mismo tiempo con la misma clave esperan su turno: no se cuela ninguno.
  perform pg_advisory_xact_lock(hashtextextended('inbound_hit:' || p_key, 0));
  delete from app.inbound_hits where hit_at < now() - interval '1 day';
  select count(*) into v_hits from app.inbound_hits where key = p_key and hit_at > now() - interval '10 minutes';
  if v_hits >= p_limit then
    return false;
  end if;
  insert into app.inbound_hits (key) values (p_key);
  return true;
end;
$$;

revoke all on table app.inbound_hits from public, anon, authenticated;
revoke all on function app.inbound_hit(text, integer) from public;
