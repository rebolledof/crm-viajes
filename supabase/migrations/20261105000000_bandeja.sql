-- SPEC-003 · Bandeja unificada, parte 1: formulario web, conversaciones, mensajes, respuestas
-- guardadas y alerta de sin responder. Migración solo aditiva: tablas nuevas, dos columnas nuevas
-- en agency_settings y funciones nuevas (create_agency se reemplaza para sembrar lo de la bandeja).
--
-- Entrada pública: el formulario lo envía un visitante sin sesión. La aplicación llama, con el
-- rol anon, a funciones del esquema app (no expuesto por la API de Supabase), que solo aceptan un
-- canal activo y sacan la agencia del canal, nunca de un dato del visitante (RF-262).

create type public.inbound_kind as enum ('formulario', 'chat', 'correo');
create type public.conversation_status as enum ('abierta', 'pendiente', 'resuelta');
create type public.message_direction as enum ('entrante', 'saliente');
create type public.message_via as enum ('formulario', 'chat', 'correo', 'whatsapp');

alter table public.agency_settings
  add column max_unanswered_minutes integer not null default 30 check (max_unanswered_minutes between 5 and 1440),
  add column privacy_url text check (privacy_url is null or (privacy_url ~ '^https?://[^\s]+$' and length(privacy_url) <= 500));

-- Canales de entrada de cada agencia. La clave pública va en el enlace del formulario.
create table public.inbound_channels (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  kind public.inbound_kind not null,
  public_key text not null unique default replace(gen_random_uuid()::text, '-', '') check (public_key ~ '^[0-9a-f]{32}$'),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (agency_id, kind)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  contact_id uuid not null,
  opportunity_id uuid,
  channel public.inbound_kind not null,
  assignee_id uuid,
  status public.conversation_status not null default 'abierta',
  subject text check (subject is null or length(btrim(subject)) between 1 and 200),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  -- Hasta cuándo se puede responder sin quedar "sin responder" (RF-265). Solo con estado abierta.
  reply_due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  foreign key (agency_id, contact_id) references public.contacts (agency_id, id),
  foreign key (agency_id, opportunity_id) references public.opportunities (agency_id, id),
  check ((status = 'abierta') or reply_due_at is null)
);
create index conversations_inbox_idx on public.conversations (agency_id, status, reply_due_at);
create index conversations_assignee_idx on public.conversations (agency_id, assignee_id, status);
create index conversations_contact_idx on public.conversations (contact_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  conversation_id uuid not null,
  direction public.message_direction not null,
  via public.message_via not null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  author_id uuid,
  -- Identificador del mensaje en el canal de origen (correo: Message-ID). No se repite (RF-260).
  external_id text check (external_id is null or length(external_id) between 1 and 300),
  created_at timestamptz not null default now(),
  foreign key (agency_id, conversation_id) references public.conversations (agency_id, id) on delete cascade,
  check ((direction = 'saliente') = (author_id is not null)),
  check (direction = 'saliente' or via in ('formulario', 'chat', 'correo')),
  check (direction = 'entrante' or via in ('chat', 'correo', 'whatsapp'))
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create unique index messages_external_idx on public.messages (agency_id, external_id) where external_id is not null;

create table public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  -- null = de la agencia (la escribe el administrador); con valor = personal de esa persona.
  owner_id uuid,
  title text not null check (length(btrim(title)) between 1 and 80),
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{1,30}$'),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index saved_replies_shortcut_idx on public.saved_replies (agency_id, owner_id, shortcut) nulls not distinct;

-- Límite de envíos públicos por ventana de 10 minutos (alcance 14). Sin RLS: nadie lo lee.
create table app.inbound_rate (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------------------------
-- Reloj de "sin responder" en horario laboral (RF-265): suma minutos solo dentro del horario.

create function app.business_deadline(p_from timestamptz, p_minutes integer, p_agency uuid) returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.agency_settings;
  v_cur timestamp;
  v_rem numeric := p_minutes;
  v_avail numeric;
begin
  select * into s from public.agency_settings where agency_id = p_agency;
  if not found then
    s.agency_id := p_agency;
    s.time_zone := 'America/Bogota';
    s.weekday_start := '08:00'; s.weekday_end := '18:00';
    s.saturday_start := '08:00'; s.saturday_end := '12:00';
  end if;
  v_cur := app.next_open(p_from at time zone s.time_zone, s);
  for i in 1..400 loop
    v_avail := extract(epoch from ((v_cur::date + app.day_end(v_cur::date, s)) - v_cur)) / 60;
    if v_rem <= v_avail then
      return (v_cur + make_interval(secs => v_rem * 60)) at time zone s.time_zone;
    end if;
    v_rem := v_rem - v_avail;
    v_cur := app.next_open((v_cur::date + 1)::timestamp, s);
  end loop;
  return p_from + make_interval(mins => p_minutes);
end;
$$;

-- Quién figura como autor de lo que crea un visitante: el administrador activo más antiguo.
-- Recibe las tareas automáticas de un contacto nuevo hasta que alguien toma la conversación.
create function app.inbound_actor(p_agency uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id from public.memberships m
  where m.agency_id = p_agency and m.role = 'admin' and m.revoked_at is null
  order by m.created_at, m.user_id limit 1;
$$;

-- Estado de la conversación según el último mensaje (RF-264).
create function app.messages_apply() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype;
  v_minutes integer;
begin
  select * into v_conv from public.conversations where id = new.conversation_id for update;
  if new.direction = 'entrante' then
    if v_conv.status <> 'abierta' or v_conv.reply_due_at is null then
      select coalesce((select max_unanswered_minutes from public.agency_settings where agency_id = new.agency_id), 30) into v_minutes;
      update public.conversations
      set status = 'abierta', resolved_at = null, last_inbound_at = new.created_at, updated_at = now(),
          reply_due_at = app.business_deadline(new.created_at, v_minutes, new.agency_id)
      where id = new.conversation_id;
    else
      update public.conversations set last_inbound_at = new.created_at, updated_at = now() where id = new.conversation_id;
    end if;
  else
    update public.conversations
    set status = 'pendiente', reply_due_at = null, resolved_at = null, last_outbound_at = new.created_at, updated_at = now()
    where id = new.conversation_id;
  end if;
  return null;
end;
$$;
create trigger messages_apply after insert on public.messages
  for each row execute function app.messages_apply();

-- Una respuesta sale por un canal que la conversación admite, y la escribe quien está en sesión.
create function app.messages_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_channel public.inbound_kind;
begin
  select channel into v_channel from public.conversations where id = new.conversation_id and agency_id = new.agency_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if new.direction = 'saliente' and new.via = 'chat' and v_channel <> 'chat' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create trigger messages_rules before insert on public.messages
  for each row execute function app.messages_rules();

-- Responsable, estado y oportunidad (RF-263). Con el rol authenticated, un asesor solo puede
-- tomar una conversación sin asignar para sí mismo; reasignar es del administrador.
create function app.conversations_rules() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.assignee_id is distinct from old.assignee_id then
    perform app.assert_active_member(new.agency_id, new.assignee_id);
    -- Quien solo lee no puede responder: no se le asigna (prueba independiente, H-8).
    if new.assignee_id is not null and exists (
      select 1 from public.memberships m
      where m.agency_id = new.agency_id and m.user_id = new.assignee_id and m.revoked_at is null and m.role = 'lectura'
    ) then
      raise exception 'assignee_read_only' using errcode = 'P0001';
    end if;
    if current_user = 'authenticated'
       and not app.has_role(new.agency_id, array['admin']::public.agency_role[])
       and not (old.assignee_id is null and new.assignee_id = auth.uid()) then
      raise exception 'permission_denied' using errcode = 'P0001';
    end if;
  end if;
  if new.opportunity_id is distinct from old.opportunity_id and new.opportunity_id is not null and not exists (
    select 1 from public.opportunities o where o.id = new.opportunity_id and o.contact_id = new.contact_id
  ) then
    raise exception 'task_contact_mismatch' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if current_user = 'authenticated' and new.status <> 'resuelta' then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    if new.status = 'resuelta' then
      new.resolved_at := now();
      new.reply_due_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger conversations_rules before update on public.conversations
  for each row execute function app.conversations_rules();

-- Respuestas guardadas: de la agencia solo el administrador; las personales, su dueño (RF-268).
create function app.saved_reply_visible(p_agency uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_member(p_agency) and (p_owner is null or p_owner = auth.uid());
$$;

create function app.saved_reply_writable(p_agency uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when p_owner is null then app.has_role(p_agency, array['admin']::public.agency_role[])
              else p_owner = auth.uid() and app.has_role(p_agency, array['admin', 'asesor']::public.agency_role[]) end;
$$;

create function app.saved_replies_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger saved_replies_rules before update on public.saved_replies
  for each row execute function app.saved_replies_rules();

-- RLS
alter table public.inbound_channels enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.saved_replies enable row level security;

create policy channels_select on public.inbound_channels for select to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]));
create policy channels_update on public.inbound_channels for update to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]));

create policy conversations_select on public.conversations for select to authenticated using (app.is_member(agency_id));
create policy conversations_update on public.conversations for update to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));

create policy messages_select on public.messages for select to authenticated using (app.is_member(agency_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[])
              and direction = 'saliente' and author_id = auth.uid() and external_id is null);

create policy replies_select on public.saved_replies for select to authenticated using (app.saved_reply_visible(agency_id, owner_id));
create policy replies_insert on public.saved_replies for insert to authenticated
  with check (app.saved_reply_writable(agency_id, owner_id) and created_by = auth.uid());
create policy replies_update on public.saved_replies for update to authenticated
  using (app.saved_reply_writable(agency_id, owner_id)) with check (app.saved_reply_writable(agency_id, owner_id));
create policy replies_delete on public.saved_replies for delete to authenticated using (app.saved_reply_writable(agency_id, owner_id));

revoke all on public.inbound_channels, public.conversations, public.messages, public.saved_replies from anon, authenticated;
grant select on public.inbound_channels to authenticated;
grant update (active, updated_at) on public.inbound_channels to authenticated;
grant select on public.conversations to authenticated;
grant update (assignee_id, status, opportunity_id) on public.conversations to authenticated;
grant select on public.messages to authenticated;
-- Drizzle escribe "default" en todas las columnas, así que el permiso es de tabla; RLS limita
-- a respuestas propias, sin identificador externo, y el trigger fija la hora.
grant insert on public.messages to authenticated;
grant select, insert, delete on public.saved_replies to authenticated;
grant update (title, shortcut, body) on public.saved_replies to authenticated;
grant update (max_unanswered_minutes, privacy_url) on public.agency_settings to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Entrada pública del formulario web (RF-260 a RF-262, RF-271).

-- Cuenta un envío; falso si la clave pasó el tope en la ventana actual de 10 minutos.
create function app.inbound_hit(p_key text, p_limit integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_window timestamptz := date_bin('10 minutes', now(), timestamptz '2000-01-01');
  v_hits integer;
begin
  delete from app.inbound_rate where window_start < now() - interval '1 day';
  insert into app.inbound_rate (key, window_start, hits) values (p_key, v_window, 1)
    on conflict (key, window_start) do update set hits = app.inbound_rate.hits + 1
    returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Datos para pintar el formulario con la marca de la agencia. Vacío si el código no existe.
create function app.web_form_info(p_key text)
returns table (agency_name text, primary_color text, accent_color text, has_logo boolean, logo_version bigint, privacy_url text, active boolean)
language sql stable security definer set search_path = ''
as $$
  select a.name, coalesce(b.primary_color, '#0F6E6E'), coalesce(b.accent_color, '#F28C28'), b.logo is not null,
         coalesce(extract(epoch from b.updated_at)::bigint, 0), s.privacy_url, c.active
  from public.inbound_channels c
  join public.agencies a on a.id = c.agency_id
  left join public.agency_branding b on b.agency_id = c.agency_id
  left join public.agency_settings s on s.agency_id = c.agency_id
  where c.public_key = p_key and c.kind = 'formulario';
$$;

create function app.web_form_logo(p_key text) returns table (logo bytea, logo_type text)
language sql stable security definer set search_path = ''
as $$
  select b.logo, b.logo_type from public.inbound_channels c
  join public.agency_branding b on b.agency_id = c.agency_id
  where c.public_key = p_key and c.kind = 'formulario' and b.logo is not null;
$$;

-- Recibe un formulario. El servidor ya validó y normalizó (teléfono E.164, correo en minúsculas);
-- aquí se vuelve a exigir lo esencial. Devuelve la conversación creada.
create function app.submit_web_form(
  p_key text, p_rate_key text, p_name text, p_phone text, p_email text,
  p_destination text, p_dates text, p_travelers integer, p_message text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_channel public.inbound_channels%rowtype;
  v_actor uuid;
  v_contact uuid;
  v_owner uuid;
  v_stage uuid;
  v_opp uuid;
  v_conv uuid;
  v_body text;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  select * into v_channel from public.inbound_channels where public_key = p_key and kind = 'formulario';
  if not found or not v_channel.active then
    raise exception 'channel_closed' using errcode = 'P0001';
  end if;
  if not app.inbound_hit('ip:' || v_channel.id || ':' || coalesce(p_rate_key, ''), 5)
     or not app.inbound_hit('agencia:' || v_channel.agency_id, 200) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if length(v_name) not between 1 and 160 or (v_phone is null and v_email is null)
     or (v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$')
     or (v_email is not null and v_email !~* '^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$')
     or length(coalesce(p_message, '')) > 4000 or length(coalesce(p_destination, '')) > 160
     or length(coalesce(p_dates, '')) > 200 or (p_travelers is not null and p_travelers not between 1 and 999) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_actor := app.inbound_actor(v_channel.agency_id);
  if v_actor is null then
    raise exception 'channel_closed' using errcode = 'P0001';
  end if;

  -- Contacto existente por teléfono o correo (reglas de duplicados de S02) o uno nuevo.
  select contact_id into v_contact from public.contact_phones where agency_id = v_channel.agency_id and e164 = v_phone;
  if v_contact is null and v_email is not null then
    select contact_id into v_contact from public.contact_emails where agency_id = v_channel.agency_id and email = v_email;
  end if;
  if v_contact is null then
    insert into public.contacts (agency_id, full_name, source, created_by)
    values (v_channel.agency_id, v_name, 'Formulario web', v_actor) returning id into v_contact;
  end if;
  if v_phone is not null then
    insert into public.contact_phones (agency_id, contact_id, e164, is_preferred)
    values (v_channel.agency_id, v_contact, v_phone,
            not exists (select 1 from public.contact_phones where contact_id = v_contact and is_preferred))
    on conflict (agency_id, e164) do nothing;
  end if;
  if v_email is not null then
    insert into public.contact_emails (agency_id, contact_id, email, is_preferred)
    values (v_channel.agency_id, v_contact, v_email,
            not exists (select 1 from public.contact_emails where contact_id = v_contact and is_preferred))
    on conflict (agency_id, email) do nothing;
  end if;

  -- Aceptó el aviso de privacidad: permiso de servicio por los canales que dejó (RF-271).
  insert into public.contact_consents (agency_id, contact_id, channel, purpose, status, source, actor_id)
  select v_channel.agency_id, v_contact, ch::public.contact_channel, 'servicio', 'otorgado',
         'Formulario web: aceptó el aviso de privacidad', v_actor
  from unnest(array_remove(array[
    case when v_phone is not null then 'whatsapp' end,
    case when v_phone is not null then 'telefono' end,
    case when v_email is not null then 'correo' end], null)) as ch
  -- Un permiso que el contacto retiró no lo vuelve a otorgar un formulario anónimo (prueba independiente, H-2).
  where coalesce((select c.status from public.contact_consents c
                  where c.contact_id = v_contact and c.channel = ch::public.contact_channel and c.purpose = 'servicio'
                  order by c.created_at desc limit 1), 'otorgado') <> 'retirado';

  -- Si el contacto ya tiene una oportunidad abierta con responsable, lo atiende esa persona.
  select o.owner_id into v_owner
  from public.opportunities o
  join public.pipeline_stages s on s.id = o.stage_id
  join public.memberships m on m.agency_id = o.agency_id and m.user_id = o.owner_id and m.revoked_at is null
  where o.contact_id = v_contact and s.kind = 'abierta' and o.owner_id is not null
  order by o.updated_at desc limit 1;

  select id into v_stage from public.pipeline_stages
  where agency_id = v_channel.agency_id and kind = 'abierta' and active order by position limit 1;
  insert into public.opportunities (agency_id, contact_id, stage_id, owner_id, source, destination, travelers, date_flexibility, notes, created_by)
  values (v_channel.agency_id, v_contact, v_stage, v_owner, 'Formulario web', nullif(btrim(coalesce(p_destination, '')), ''),
          p_travelers, nullif(btrim(coalesce(p_dates, '')), ''), nullif(btrim(coalesce(p_message, '')), ''), v_actor)
  returning id into v_opp;

  insert into public.conversations (agency_id, contact_id, opportunity_id, channel, assignee_id, subject)
  values (v_channel.agency_id, v_contact, v_opp, 'formulario', v_owner,
          left('Formulario web' || coalesce(' · ' || nullif(btrim(coalesce(p_destination, '')), ''), ''), 200))
  returning id into v_conv;

  v_body := concat_ws(E'\n',
    nullif(btrim(coalesce(p_message, '')), ''),
    'Destino: ' || nullif(btrim(coalesce(p_destination, '')), ''),
    'Fechas: ' || nullif(btrim(coalesce(p_dates, '')), ''),
    'Viajeros: ' || p_travelers::text);
  if coalesce(btrim(v_body), '') = '' then
    v_body := 'Pidió que lo contacten (formulario sin mensaje).';
  end if;
  insert into public.messages (agency_id, conversation_id, direction, via, body)
  values (v_channel.agency_id, v_conv, 'entrante', 'formulario', left(v_body, 4000));

  insert into public.activities (agency_id, contact_id, opportunity_id, kind, data, actor_id)
  values (v_channel.agency_id, v_contact, v_opp, 'bandeja.recibido',
          jsonb_build_object('canal', 'formulario', 'conversacion', v_conv), v_actor);
  return v_conv;
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- Siembra: canal de formulario y 5 respuestas guardadas de ejemplo por agencia.

create function app.seed_inbox(p_agency uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.agency_settings (agency_id) values (p_agency) on conflict do nothing;
  insert into public.inbound_channels (agency_id, kind) values (p_agency, 'formulario') on conflict do nothing;
  if exists (select 1 from public.saved_replies where agency_id = p_agency and owner_id is null) then
    return;
  end if;
  insert into public.saved_replies (agency_id, title, shortcut, body, created_by) values
    (p_agency, 'Saludo y pedir datos', 'saludo',
     'Hola {nombre}, soy {asesor} de {agencia}. ¡Gracias por escribirnos! Para prepararte una propuesta, cuéntame: fechas aproximadas, número de viajeros (adultos y niños) y presupuesto por persona.', p_actor),
    (p_agency, 'Pedir fechas y viajeros', 'datos',
     'Para cotizarte necesito: fecha de salida y de regreso (o si son flexibles), ciudad de salida, número de adultos y niños con sus edades.', p_actor),
    (p_agency, 'Formas de pago', 'pagos',
     'Recibimos transferencia bancaria y tarjeta de crédito. Para separar tu viaje pedimos un abono y el saldo antes de la fecha límite que te indico en la propuesta.', p_actor),
    (p_agency, 'Documentos para viajar', 'documentos',
     'Para viajar necesitas pasaporte con al menos 6 meses de vigencia. Según el destino puede hacer falta visa, vacunas o seguro de viaje; te confirmo los requisitos de tu destino.', p_actor),
    (p_agency, 'Fuera de horario', 'horario',
     'Hola {nombre}, gracias por escribir a {agencia}. Te respondo en nuestro horario de atención. ¡Hablamos pronto!', p_actor);
end;
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
  perform app.seed_followups(v_id, v_uid);
  perform app.seed_inbox(v_id, v_uid);
  insert into public.audit_events (agency_id, actor_id, action, object_type, object_id, changes)
    values (v_id, v_uid, 'agency.created', 'agency', v_id::text, jsonb_build_object('name', btrim(p_name), 'slug', p_slug));
  return v_id;
end;
$$;
revoke all on function public.create_agency(text, text) from public, anon;
grant execute on function public.create_agency(text, text) to authenticated;

-- Privilegios de funciones: nada para public; cada rol recibe solo lo que usa.
revoke all on all functions in schema app from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.agency_role[]) to authenticated;
grant execute on function app.template_visible(uuid, uuid), app.template_writable(uuid, uuid),
  app.step_template_visible(uuid), app.step_template_writable(uuid), app.personal_templates_allowed(uuid) to authenticated;
grant execute on function app.saved_reply_visible(uuid, uuid), app.saved_reply_writable(uuid, uuid),
  app.assert_active_member(uuid, uuid) to authenticated;
grant usage on schema app to anon;
grant execute on function app.web_form_info(text), app.web_form_logo(text),
  app.submit_web_form(text, text, text, text, text, text, text, integer, text) to anon;

-- Agencias que ya existían.
select app.seed_inbox(a.id, a.created_by) from public.agencies a;
