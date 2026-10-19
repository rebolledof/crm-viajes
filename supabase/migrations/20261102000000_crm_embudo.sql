-- SPEC-002 · Contactos, consentimiento, embudo por agencia, oportunidades, tareas e historial.
-- Mismo modelo que la base: agency_id en cada tabla, RLS ligado a la membresía activa y
-- privilegios mínimos. Las relaciones usan claves compuestas (agency_id, id) para que una fila
-- nunca apunte a otra agencia, aunque alguien salte la aplicación.

create type public.stage_kind as enum ('abierta', 'ganada', 'perdida');
create type public.loss_reason as enum ('precio', 'sin_disponibilidad', 'cambio_de_planes', 'sin_respuesta', 'competencia', 'otro');
create type public.contact_channel as enum ('whatsapp', 'correo', 'telefono');
create type public.consent_purpose as enum ('servicio', 'promociones');
create type public.consent_status as enum ('otorgado', 'retirado');
create type public.task_kind as enum ('llamada', 'seguimiento', 'recordatorio', 'correo', 'reunion', 'tarea');
create type public.task_status as enum ('abierta', 'completada', 'cancelada');
create type public.priority as enum ('baja', 'media', 'alta');
create type public.currency_code as enum ('COP', 'USD');

-- Miembro activo de la agencia (RF-214). Se usa en triggers de responsables y asignados.
create function app.assert_active_member(p_agency uuid, p_user uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_user is null then return; end if;
  if not exists (
    select 1 from public.memberships m
    where m.agency_id = p_agency and m.user_id = p_user and m.revoked_at is null
  ) then
    raise exception 'not_active_member' using errcode = 'P0001';
  end if;
end;
$$;

-- Etapas del embudo, propias de cada agencia (RF-215 a RF-217).
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  position integer not null check (position >= 0),
  kind public.stage_kind not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (agency_id, id)
);
create unique index pipeline_stages_name_idx on public.pipeline_stages (agency_id, lower(btrim(name)));
create index pipeline_stages_order_idx on public.pipeline_stages (agency_id, position);

-- Siempre queda al menos una etapa activa de cada tipo.
create function app.pipeline_stages_keep_kinds() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.pipeline_stages s
    where s.agency_id = old.agency_id and s.kind = old.kind and s.active
  ) and exists (select 1 from public.agencies a where a.id = old.agency_id) then
    raise exception 'last_stage_of_kind' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create trigger pipeline_stages_keep_kinds after update or delete on public.pipeline_stages
  for each row execute function app.pipeline_stages_keep_kinds();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 160),
  language text check (language is null or language ~ '^[a-z]{2}$'),
  city text check (city is null or length(btrim(city)) between 1 and 120),
  tags text[] not null default '{}',
  owner_id uuid,
  source text check (source is null or length(btrim(source)) between 1 and 80),
  notes text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id)
);
create index contacts_agency_idx on public.contacts (agency_id, created_at desc);
create index contacts_name_idx on public.contacts (agency_id, lower(full_name));

create table public.contact_phones (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  contact_id uuid not null,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  label text check (label is null or length(btrim(label)) between 1 and 40),
  is_preferred boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (agency_id, contact_id) references public.contacts (agency_id, id) on delete cascade,
  unique (agency_id, e164)
);
create unique index contact_phones_preferred_idx on public.contact_phones (contact_id) where is_preferred;

create table public.contact_emails (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  contact_id uuid not null,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_preferred boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (agency_id, contact_id) references public.contacts (agency_id, id) on delete cascade,
  unique (agency_id, email)
);
create unique index contact_emails_preferred_idx on public.contact_emails (contact_id) where is_preferred;

-- Consentimiento: solo se agregan registros; el vigente es el último por canal y finalidad.
create table public.contact_consents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  contact_id uuid not null,
  channel public.contact_channel not null,
  purpose public.consent_purpose not null,
  status public.consent_status not null,
  source text not null check (length(btrim(source)) between 1 and 200),
  actor_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (agency_id, contact_id) references public.contacts (agency_id, id) on delete cascade
);
create index contact_consents_idx on public.contact_consents (contact_id, channel, purpose, created_at desc);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  contact_id uuid not null,
  stage_id uuid not null,
  owner_id uuid,
  source text check (source is null or length(btrim(source)) between 1 and 80),
  destination text check (destination is null or length(btrim(destination)) between 1 and 160),
  product text check (product is null or length(btrim(product)) between 1 and 160),
  travel_start date,
  travel_end date,
  date_flexibility text check (date_flexibility is null or length(btrim(date_flexibility)) between 1 and 200),
  travelers integer check (travelers is null or travelers between 1 and 999),
  budget_amount numeric(14, 2) check (budget_amount is null or budget_amount >= 0),
  budget_currency public.currency_code,
  priority public.priority not null default 'media',
  notes text,
  lost_reason public.loss_reason,
  lost_note text,
  won_evidence text,
  closed_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  foreign key (agency_id, contact_id) references public.contacts (agency_id, id),
  foreign key (agency_id, stage_id) references public.pipeline_stages (agency_id, id),
  -- RF-207: importe y moneda van juntos; COP sin decimales.
  check ((budget_amount is null) = (budget_currency is null)),
  check (budget_currency is distinct from 'COP' or budget_amount = trunc(budget_amount)),
  check (travel_end is null or travel_start is null or travel_end >= travel_start)
);
create index opportunities_board_idx on public.opportunities (agency_id, stage_id, updated_at desc);
create index opportunities_contact_idx on public.opportunities (contact_id);
create index opportunities_owner_idx on public.opportunities (agency_id, owner_id);

-- Reglas de cierre según el tipo de la etapa (RF-208, RF-209, RF-217).
create function app.opportunities_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_stage public.pipeline_stages%rowtype;
begin
  select * into v_stage from public.pipeline_stages where id = new.stage_id and agency_id = new.agency_id;
  if not found then
    raise exception 'stage_not_found' using errcode = 'P0001';
  end if;
  if (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) and not v_stage.active then
    raise exception 'stage_inactive' using errcode = 'P0001';
  end if;
  perform app.assert_active_member(new.agency_id, new.owner_id);

  if v_stage.kind = 'perdida' then
    if new.lost_reason is null then
      raise exception 'lost_reason_required' using errcode = 'P0001';
    end if;
    if new.lost_reason = 'otro' and coalesce(btrim(new.lost_note), '') = '' then
      raise exception 'lost_note_required' using errcode = 'P0001';
    end if;
    new.won_evidence := null;
  elsif v_stage.kind = 'ganada' then
    if coalesce(btrim(new.won_evidence), '') = '' then
      raise exception 'won_evidence_required' using errcode = 'P0001';
    end if;
    new.lost_reason := null;
    new.lost_note := null;
  else
    new.lost_reason := null;
    new.lost_note := null;
    new.won_evidence := null;
  end if;

  if v_stage.kind = 'abierta' then
    new.closed_at := null;
  elsif tg_op = 'INSERT' or new.closed_at is null or new.stage_id is distinct from old.stage_id then
    new.closed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger opportunities_rules before insert or update on public.opportunities
  for each row execute function app.opportunities_rules();

create function app.contacts_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.assert_active_member(new.agency_id, new.owner_id);
  new.updated_at := now();
  return new;
end;
$$;
create trigger contacts_rules before insert or update on public.contacts
  for each row execute function app.contacts_rules();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  contact_id uuid not null,
  opportunity_id uuid,
  kind public.task_kind not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  assignee_id uuid not null,
  due_at timestamptz not null,
  priority public.priority not null default 'media',
  status public.task_status not null default 'abierta',
  result text,
  completed_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (agency_id, contact_id) references public.contacts (agency_id, id),
  foreign key (agency_id, opportunity_id) references public.opportunities (agency_id, id),
  -- RF-211: completar exige resultado.
  check (status <> 'completada' or (coalesce(btrim(result), '') <> '' and completed_at is not null))
);
create index tasks_assignee_idx on public.tasks (agency_id, assignee_id, status, due_at);
create index tasks_opportunity_idx on public.tasks (opportunity_id, status, due_at);

create function app.tasks_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.assert_active_member(new.agency_id, new.assignee_id);
  if new.opportunity_id is not null and not exists (
    select 1 from public.opportunities o where o.id = new.opportunity_id and o.contact_id = new.contact_id
  ) then
    raise exception 'task_contact_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger tasks_rules before insert or update on public.tasks
  for each row execute function app.tasks_rules();

-- Historial de la ficha (RF-213): solo se agregan registros.
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  contact_id uuid not null,
  opportunity_id uuid,
  kind text not null check (kind ~ '^[a-z_]+\.[a-z_]+$'),
  data jsonb not null default '{}'::jsonb,
  actor_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (agency_id, contact_id) references public.contacts (agency_id, id) on delete cascade,
  foreign key (agency_id, opportunity_id) references public.opportunities (agency_id, id)
);
create index activities_contact_idx on public.activities (contact_id, created_at desc);

-- RLS
alter table public.pipeline_stages enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_phones enable row level security;
alter table public.contact_emails enable row level security;
alter table public.contact_consents enable row level security;
alter table public.opportunities enable row level security;
alter table public.tasks enable row level security;
alter table public.activities enable row level security;

create policy stages_select on public.pipeline_stages for select to authenticated using (app.is_member(agency_id));
create policy stages_insert on public.pipeline_stages for insert to authenticated
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]));
create policy stages_update on public.pipeline_stages for update to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]));

create policy contacts_select on public.contacts for select to authenticated using (app.is_member(agency_id));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and created_by = auth.uid());
create policy contacts_update on public.contacts for update to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));

create policy phones_select on public.contact_phones for select to authenticated using (app.is_member(agency_id));
create policy phones_write on public.contact_phones for all to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));

create policy emails_select on public.contact_emails for select to authenticated using (app.is_member(agency_id));
create policy emails_write on public.contact_emails for all to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));

create policy consents_select on public.contact_consents for select to authenticated using (app.is_member(agency_id));
create policy consents_insert on public.contact_consents for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and actor_id = auth.uid());

create policy opportunities_select on public.opportunities for select to authenticated using (app.is_member(agency_id));
create policy opportunities_insert on public.opportunities for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and created_by = auth.uid());
create policy opportunities_update on public.opportunities for update to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));

create policy tasks_select on public.tasks for select to authenticated using (app.is_member(agency_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and created_by = auth.uid());
create policy tasks_update on public.tasks for update to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));

create policy activities_select on public.activities for select to authenticated using (app.is_member(agency_id));
create policy activities_insert on public.activities for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and actor_id = auth.uid());

-- Privilegios mínimos: sin borrar salvo teléfonos y correos de un contacto.
revoke all on public.pipeline_stages, public.contacts, public.contact_phones, public.contact_emails,
  public.contact_consents, public.opportunities, public.tasks, public.activities from anon, authenticated;
grant select, insert on public.pipeline_stages to authenticated;
grant update (name, position, active) on public.pipeline_stages to authenticated;
grant select, insert on public.contacts to authenticated;
grant update (full_name, language, city, tags, owner_id, source, notes) on public.contacts to authenticated;
grant select, insert, delete on public.contact_phones, public.contact_emails to authenticated;
grant update (label, is_preferred) on public.contact_phones to authenticated;
grant update (is_preferred) on public.contact_emails to authenticated;
grant select, insert on public.contact_consents to authenticated;
grant select, insert on public.opportunities to authenticated;
grant update (stage_id, owner_id, source, destination, product, travel_start, travel_end, date_flexibility,
  travelers, budget_amount, budget_currency, priority, notes, lost_reason, lost_note, won_evidence)
  on public.opportunities to authenticated;
grant select, insert on public.tasks to authenticated;
grant update (kind, title, assignee_id, due_at, priority, status, result, completed_at) on public.tasks to authenticated;
grant select, insert on public.activities to authenticated;
revoke all on all functions in schema app from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.agency_role[]) to authenticated;

-- Etapas iniciales del briefing (6.2). Cada agencia las puede cambiar después.
create function app.seed_pipeline(p_agency uuid) returns void
language sql security definer set search_path = ''
as $$
  insert into public.pipeline_stages (agency_id, name, position, kind)
  select p_agency, s.name, s.pos, s.kind::public.stage_kind
  from (values
    ('Nuevo', 0, 'abierta'),
    ('Pendiente de contacto', 1, 'abierta'),
    ('Contactado', 2, 'abierta'),
    ('En calificación', 3, 'abierta'),
    ('Calificado', 4, 'abierta'),
    ('Preparando propuesta', 5, 'abierta'),
    ('Propuesta enviada', 6, 'abierta'),
    ('Negociación', 7, 'abierta'),
    ('Ganado', 8, 'ganada'),
    ('Perdido', 9, 'perdida')
  ) as s(name, pos, kind)
  where not exists (select 1 from public.pipeline_stages x where x.agency_id = p_agency);
$$;

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
  insert into public.agencies (name, slug, created_by) values (btrim(p_name), p_slug, v_uid)
    returning id into v_id;
  insert into public.memberships (agency_id, user_id, email, role) values (v_id, v_uid, v_email, 'admin');
  perform app.seed_pipeline(v_id);
  insert into public.audit_events (agency_id, actor_id, action, object_type, object_id, changes)
    values (v_id, v_uid, 'agency.created', 'agency', v_id::text, jsonb_build_object('name', btrim(p_name), 'slug', p_slug));
  return v_id;
end;
$$;
revoke all on function public.create_agency(text, text) from public, anon;
grant execute on function public.create_agency(text, text) to authenticated;

-- Agencias que ya existían antes de esta migración.
select app.seed_pipeline(id) from public.agencies;
