-- Acceso retirado (informe de pruebas S04, 6 nov 2026): quien perdió el acceso a su agencia y no
-- tiene ninguna otra activa no puede crear una agencia propia; ve un aviso y puede aceptar una
-- invitación nueva. create_agency se reemplaza con el mismo cuerpo más esa revisión.
create or replace function public.create_agency(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.memberships where user_id = v_uid and revoked_at is null)
     and exists (select 1 from public.memberships where user_id = v_uid and revoked_at is not null) then
    raise exception 'access_revoked' using errcode = 'P0001';
  end if;
  insert into public.agencies (name, slug, created_by) values (btrim(p_name), p_slug, v_uid)
    returning id into v_id;
  insert into public.memberships (agency_id, user_id, email, role) values (v_id, v_uid, v_email, 'admin');
  perform app.seed_pipeline(v_id);
  perform app.seed_followups(v_id, v_uid);
  perform app.seed_inbox(v_id, v_uid);
  insert into public.audit_events (agency_id, actor_id, action, object_type, object_id, changes)
    values (v_id, v_uid, 'agency.created', 'agency', v_id::text, jsonb_build_object('name', btrim(p_name), 'slug', p_slug));
  return v_id;
end;
$$;
revoke all on function public.create_agency(text, text) from public, anon;
grant execute on function public.create_agency(text, text) to authenticated;

-- Las agencias donde la persona tuvo acceso y se lo retiraron (RLS no le deja leer esas filas).
-- Solo devuelve el nombre de la agencia y la fecha; nada más de esa agencia.
create function public.my_revoked_access() returns table (agency_name text, revoked_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select a.name, m.revoked_at
  from public.memberships m
  join public.agencies a on a.id = m.agency_id
  where m.user_id = auth.uid() and m.revoked_at is not null
  order by m.revoked_at desc;
$$;
revoke all on function public.my_revoked_access() from public, anon;
grant execute on function public.my_revoked_access() to authenticated;
