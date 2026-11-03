-- SPEC-000 RF-01, RF-02, RF-14 · Agencias, membresías, invitaciones y auditoría.
-- Aislamiento: cada tabla lleva agency_id y RLS ligado a la membresía activa del usuario.

create schema if not exists app;

create type public.agency_role as enum ('admin', 'asesor', 'lectura');

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role public.agency_role not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role public.agency_role not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users (id),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_agency_idx on public.invitations (agency_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  actor_id uuid references auth.users (id),
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  object_type text not null,
  object_id text,
  changes jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_events_agency_idx on public.audit_events (agency_id, created_at desc);

-- Funciones de autorización. SECURITY DEFINER para que las políticas no se llamen a sí mismas.
create function app.is_member(p_agency uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.agency_id = p_agency and m.user_id = auth.uid() and m.revoked_at is null
  );
$$;

create function app.has_role(p_agency uuid, p_roles public.agency_role[]) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.agency_id = p_agency and m.user_id = auth.uid() and m.revoked_at is null
      and m.role = any (p_roles)
  );
$$;

alter table public.agencies enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;

create policy agencies_select on public.agencies for select to authenticated
  using (app.is_member(id));
create policy agencies_update on public.agencies for update to authenticated
  using (app.has_role(id, array['admin']::public.agency_role[]))
  with check (app.has_role(id, array['admin']::public.agency_role[]));

create policy memberships_select on public.memberships for select to authenticated
  using (app.is_member(agency_id));
create policy memberships_update on public.memberships for update to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]) and user_id <> auth.uid())
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]) and user_id <> auth.uid());

create policy invitations_select on public.invitations for select to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]) and invited_by = auth.uid()
              and accepted_at is null and revoked_at is null);
create policy invitations_update on public.invitations for update to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]));

create policy audit_select on public.audit_events for select to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]));
create policy audit_insert on public.audit_events for insert to authenticated
  with check (app.is_member(agency_id) and actor_id = auth.uid());

-- Privilegios mínimos. Supabase concede todo a anon y authenticated por defecto; se restringe.
revoke all on public.agencies, public.memberships, public.invitations, public.audit_events from anon, authenticated;
grant select on public.agencies to authenticated;
grant update (name) on public.agencies to authenticated;
grant select on public.memberships to authenticated;
grant update (role, revoked_at) on public.memberships to authenticated;
grant select, insert on public.invitations to authenticated;
grant update (revoked_at) on public.invitations to authenticated;
grant select, insert on public.audit_events to authenticated;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.agency_role[]) to authenticated;

-- Crear una agencia: el creador queda como admin en la misma transacción.
create function public.create_agency(p_name text, p_slug text) returns uuid
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
  insert into public.agencies (name, slug, created_by) values (btrim(p_name), p_slug, v_uid)
    returning id into v_id;
  insert into public.memberships (agency_id, user_id, email, role) values (v_id, v_uid, v_email, 'admin');
  insert into public.audit_events (agency_id, actor_id, action, object_type, object_id, changes)
    values (v_id, v_uid, 'agency.created', 'agency', v_id::text, jsonb_build_object('name', btrim(p_name), 'slug', p_slug));
  return v_id;
end;
$$;

-- Aceptar una invitación: vigente, no usada, no revocada y dirigida al correo de la sesión.
create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_inv from public.invitations
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    for update;
  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null
     or v_inv.expires_at <= now() or v_inv.email <> v_email then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;
  insert into public.memberships (agency_id, user_id, email, role) values (v_inv.agency_id, v_uid, v_email, v_inv.role)
    on conflict (agency_id, user_id) do update set role = excluded.role, email = excluded.email, revoked_at = null;
  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  insert into public.audit_events (agency_id, actor_id, action, object_type, object_id, changes)
    values (v_inv.agency_id, v_uid, 'invitation.accepted', 'invitation', v_inv.id::text, jsonb_build_object('role', v_inv.role));
  return v_inv.agency_id;
end;
$$;

revoke all on function public.create_agency(text, text), public.accept_invitation(text) from public, anon;
grant execute on function public.create_agency(text, text), public.accept_invitation(text) to authenticated;
