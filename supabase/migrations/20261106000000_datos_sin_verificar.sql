-- D-14 (decisión de Felipe, 2 nov 2026): un teléfono o correo que llega por el formulario web a un
-- contacto que ya existía queda "sin verificar". Cualquiera que conozca el teléfono de un cliente
-- podría mandar el formulario y agregarle un correo propio; ese dato no se usa para responder
-- hasta que un asesor lo confirma en la ficha del contacto. Migración solo aditiva.

alter table public.contact_phones add column unverified boolean not null default false;
alter table public.contact_emails add column unverified boolean not null default false;

-- Confirmar es poner unverified en false; RLS (phones_write, emails_write) ya limita a asesor y admin.
grant update (unverified) on public.contact_phones, public.contact_emails to authenticated;

-- El formulario marca sin verificar lo nuevo de un contacto existente y no lo vuelve preferido.
create or replace function app.submit_web_form(
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
  v_existing boolean := false;
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
  v_existing := v_contact is not null;
  if v_contact is null then
    insert into public.contacts (agency_id, full_name, source, created_by)
    values (v_channel.agency_id, v_name, 'Formulario web', v_actor) returning id into v_contact;
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

revoke all on function app.submit_web_form(text, text, text, text, text, text, text, integer, text) from public;
grant execute on function app.submit_web_form(text, text, text, text, text, text, text, integer, text) to anon;
