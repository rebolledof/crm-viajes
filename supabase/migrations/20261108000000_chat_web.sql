-- SPEC-003 parte 2 · Chat web (spec-parte-2-chat.md). Migración solo aditiva: canal de chat por
-- agencia (pausado al crearse), tabla de visitantes y funciones públicas del chat. Se reemplazan
-- app.seed_inbox (para sembrar el canal de chat) y app.web_form_logo (para servir el logo también
-- con el código del chat); ninguna borra datos.
--
-- El visitante no tiene sesión. Su navegador guarda una llave aleatoria que crea el servidor; la
-- base solo guarda la huella (sha256) y con ella decide qué conversación puede ver (RF-273). La
-- agencia sale siempre del código del chat, nunca de un dato del visitante (RF-262).

-- Visitantes del chat. Nadie de la aplicación la lee: solo las funciones del chat.
create table public.chat_visitors (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  conversation_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (agency_id, conversation_id) references public.conversations (agency_id, id) on delete cascade
);
create index chat_visitors_conversation_idx on public.chat_visitors (conversation_id);
alter table public.chat_visitors enable row level security;
revoke all on table public.chat_visitors from public, anon, authenticated;

-- Canal de chat de cada agencia, pausado hasta que el administrador lo encienda.
create or replace function app.seed_inbox(p_agency uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.agency_settings (agency_id) values (p_agency) on conflict do nothing;
  insert into public.inbound_channels (agency_id, kind) values (p_agency, 'formulario') on conflict do nothing;
  insert into public.inbound_channels (agency_id, kind, active) values (p_agency, 'chat', false) on conflict do nothing;
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
insert into public.inbound_channels (agency_id, kind, active) select a.id, 'chat', false from public.agencies a on conflict do nothing;

-- El logo se sirve con el código del formulario o del chat.
create or replace function app.web_form_logo(p_key text) returns table (logo bytea, logo_type text)
language sql stable security definer set search_path = ''
as $$
  select b.logo, b.logo_type from public.inbound_channels c
  join public.agency_branding b on b.agency_id = c.agency_id
  where c.public_key = p_key and c.kind in ('formulario', 'chat') and b.logo is not null;
$$;

-- Datos para pintar el chat: marca, si está activo y si la agencia está en horario (AC-281).
-- next_open es la hora local en que abre (o la actual si está abierta); local_now, la hora local.
create function app.chat_info(p_key text)
returns table (agency_name text, primary_color text, accent_color text, has_logo boolean, logo_version bigint,
               privacy_url text, active boolean, open_now boolean, next_open timestamp, local_now timestamp)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_channel public.inbound_channels%rowtype;
  s public.agency_settings;
  v_local timestamp;
  v_next timestamp;
begin
  select * into v_channel from public.inbound_channels where public_key = p_key and kind = 'chat';
  if not found then
    return;
  end if;
  select * into s from public.agency_settings where agency_id = v_channel.agency_id;
  if not found then
    s.time_zone := 'America/Bogota';
    s.weekday_start := '08:00'; s.weekday_end := '18:00';
    s.saturday_start := '08:00'; s.saturday_end := '12:00';
  end if;
  v_local := now() at time zone s.time_zone;
  v_next := app.next_open(v_local, s);
  return query
    select a.name, coalesce(b.primary_color, '#0F6E6E'), coalesce(b.accent_color, '#F28C28'), b.logo is not null,
           coalesce(extract(epoch from b.updated_at)::bigint, 0), s.privacy_url, v_channel.active,
           v_next = v_local, v_next, v_local
    from public.agencies a
    left join public.agency_branding b on b.agency_id = a.id
    where a.id = v_channel.agency_id;
end;
$$;

-- Visitante válido del chat: la llave existe, es de la agencia del chat y tuvo mensajes en los
-- últimos 30 días (RF-273, AC-280). Devuelve la conversación o null.
create function app.chat_visitor(p_channel public.inbound_channels, p_token_hash text) returns uuid
language sql stable security definer set search_path = ''
as $$
  select v.conversation_id
  from public.chat_visitors v
  join public.conversations c on c.id = v.conversation_id and c.agency_id = v.agency_id
  where v.token_hash = p_token_hash and v.agency_id = p_channel.agency_id and c.channel = 'chat'
    and coalesce(greatest(c.last_inbound_at, c.last_outbound_at), v.created_at) > now() - interval '30 days';
$$;

-- Primer mensaje del chat (RF-272). El servidor ya validó y normalizó; aquí se exige lo esencial.
-- Crea o vincula el contacto (D-16: lo nuevo de un contacto existente queda sin verificar),
-- registra el consentimiento, crea la conversación sin oportunidad y guarda la huella de la llave.
create function app.chat_start(
  p_key text, p_rate_key text, p_token_hash text, p_name text, p_phone text, p_email text, p_message text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_channel public.inbound_channels%rowtype;
  v_actor uuid;
  v_contact uuid;
  v_owner uuid;
  v_conv uuid;
  v_existing boolean := false;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_body text := btrim(coalesce(p_message, ''));
begin
  select * into v_channel from public.inbound_channels where public_key = p_key and kind = 'chat';
  if not found or not v_channel.active then
    raise exception 'channel_closed' using errcode = 'P0001';
  end if;
  if not app.inbound_hit('chat-ip:' || v_channel.id || ':' || coalesce(p_rate_key, ''), 5)
     or not app.inbound_hit('agencia:' || v_channel.agency_id, 200) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if length(v_name) not between 1 and 160 or (v_phone is null and v_email is null)
     or (v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$')
     or (v_email is not null and v_email !~* '^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$')
     or length(v_body) not between 1 and 4000
     or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_actor := app.inbound_actor(v_channel.agency_id);
  if v_actor is null then
    raise exception 'channel_closed' using errcode = 'P0001';
  end if;

  select contact_id into v_contact from public.contact_phones where agency_id = v_channel.agency_id and e164 = v_phone;
  if v_contact is null and v_email is not null then
    select contact_id into v_contact from public.contact_emails where agency_id = v_channel.agency_id and email = v_email;
  end if;
  v_existing := v_contact is not null;
  if v_contact is null then
    insert into public.contacts (agency_id, full_name, source, created_by)
    values (v_channel.agency_id, v_name, 'Chat web', v_actor) returning id into v_contact;
  end if;
  if v_phone is not null then
    insert into public.contact_phones (agency_id, contact_id, e164, is_preferred, unverified)
    values (v_channel.agency_id, v_contact, v_phone,
            not v_existing and not exists (select 1 from public.contact_phones where contact_id = v_contact and is_preferred),
            v_existing)
    on conflict (agency_id, e164) do nothing;
  end if;
  if v_email is not null then
    insert into public.contact_emails (agency_id, contact_id, email, is_preferred, unverified)
    values (v_channel.agency_id, v_contact, v_email,
            not v_existing and not exists (select 1 from public.contact_emails where contact_id = v_contact and is_preferred),
            v_existing)
    on conflict (agency_id, email) do nothing;
  end if;

  -- Aceptó el aviso de privacidad (RF-271). Un permiso retirado no se vuelve a otorgar.
  insert into public.contact_consents (agency_id, contact_id, channel, purpose, status, source, actor_id)
  select v_channel.agency_id, v_contact, ch::public.contact_channel, 'servicio', 'otorgado',
         'Chat web: aceptó el aviso de privacidad', v_actor
  from unnest(array_remove(array[
    case when v_phone is not null then 'whatsapp' end,
    case when v_phone is not null then 'telefono' end,
    case when v_email is not null then 'correo' end], null)) as ch
  where coalesce((select c.status from public.contact_consents c
                  where c.contact_id = v_contact and c.channel = ch::public.contact_channel and c.purpose = 'servicio'
                  order by c.created_at desc limit 1), 'otorgado') <> 'retirado';

  -- Si el contacto ya tiene una oportunidad abierta con responsable activo, lo atiende esa persona.
  select o.owner_id into v_owner
  from public.opportunities o
  join public.pipeline_stages s on s.id = o.stage_id
  join public.memberships m on m.agency_id = o.agency_id and m.user_id = o.owner_id and m.revoked_at is null and m.role <> 'lectura'
  where o.contact_id = v_contact and s.kind = 'abierta' and o.owner_id is not null
  order by o.updated_at desc limit 1;

  -- El chat no crea oportunidad (también escriben proveedores o clientes con viaje en curso).
  insert into public.conversations (agency_id, contact_id, channel, assignee_id, subject)
  values (v_channel.agency_id, v_contact, 'chat', v_owner, 'Chat web')
  returning id into v_conv;
  insert into public.messages (agency_id, conversation_id, direction, via, body)
  values (v_channel.agency_id, v_conv, 'entrante', 'chat', v_body);
  insert into public.chat_visitors (agency_id, conversation_id, token_hash) values (v_channel.agency_id, v_conv, p_token_hash);
  -- Cuenta el primer mensaje para el límite de la conversación.
  perform app.inbound_hit('chat-conv:' || v_conv, 30);

  insert into public.activities (agency_id, contact_id, kind, data, actor_id)
  values (v_channel.agency_id, v_contact, 'bandeja.recibido', jsonb_build_object('canal', 'chat', 'conversacion', v_conv), v_actor);
  return v_conv;
end;
$$;

-- Mensaje siguiente del visitante (RF-276): reabre la conversación si estaba pendiente o resuelta.
create function app.chat_send(p_key text, p_token_hash text, p_message text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_channel public.inbound_channels%rowtype;
  v_conv uuid;
  v_body text := btrim(coalesce(p_message, ''));
begin
  select * into v_channel from public.inbound_channels where public_key = p_key and kind = 'chat';
  if not found or not v_channel.active then
    raise exception 'channel_closed' using errcode = 'P0001';
  end if;
  v_conv := app.chat_visitor(v_channel, p_token_hash);
  if v_conv is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if length(v_body) not between 1 and 4000 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if not app.inbound_hit('chat-conv:' || v_conv, 30) or not app.inbound_hit('agencia:' || v_channel.agency_id, 200) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.messages (agency_id, conversation_id, direction, via, body)
  values (v_channel.agency_id, v_conv, 'entrante', 'chat', v_body);
end;
$$;

-- Mensajes de la conversación del visitante, y nada más (RF-273, AC-272). Del asesor solo se
-- muestra el nombre de pila sacado de su correo, nunca el correo. Llave inválida: ninguna fila.
create function app.chat_messages(p_key text, p_token_hash text)
returns table (id uuid, direction public.message_direction, body text, author_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_channel public.inbound_channels%rowtype;
  v_conv uuid;
begin
  select * into v_channel from public.inbound_channels where public_key = p_key and kind = 'chat';
  if not found then
    return;
  end if;
  v_conv := app.chat_visitor(v_channel, p_token_hash);
  if v_conv is null then
    return;
  end if;
  return query
    select m.id, m.direction, m.body,
           case when m.direction = 'saliente' then
             initcap(coalesce(substring(split_part(mb.email, '@', 1) from '[^._+0-9-]+'), 'Asesor')) end,
           m.created_at
    from public.messages m
    left join public.memberships mb on mb.agency_id = m.agency_id and mb.user_id = m.author_id
    where m.conversation_id = v_conv and m.agency_id = v_channel.agency_id
      -- Lo que el asesor envió por WhatsApp o correo no se muestra en el chat.
      and m.via in ('chat', 'formulario')
    order by m.created_at, m.id;
end;
$$;

revoke all on function app.chat_info(text), app.chat_visitor(public.inbound_channels, text),
  app.chat_start(text, text, text, text, text, text, text), app.chat_send(text, text, text),
  app.chat_messages(text, text), app.seed_inbox(uuid, uuid), app.web_form_logo(text) from public;
grant execute on function app.chat_info(text), app.chat_start(text, text, text, text, text, text, text),
  app.chat_send(text, text, text), app.chat_messages(text, text), app.web_form_logo(text) to anon;
