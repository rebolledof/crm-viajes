-- SPEC-002b · Plantillas de seguimiento: tareas que se crean y se cancelan solas según el embudo.
-- El motor vive en la base (trigger sobre opportunities) para que cualquier entrada futura
-- (formulario web, importación CSV, bandeja) aplique las mismas reglas sin depender de la pantalla.

create type public.followup_trigger as enum ('creada', 'etapa', 'ganada', 'perdida');
create type public.edit_level as enum ('bloqueada', 'ajustable', 'libre');
create type public.delay_unit as enum ('minutos', 'horas_habiles', 'dias_habiles', 'dias');

-- Ajustes de la agencia: horario laboral (hora local) y plantillas personales (RF-227).
create table public.agency_settings (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  time_zone text not null default 'America/Bogota',
  weekday_start time not null default '08:00',
  weekday_end time not null default '18:00',
  saturday_start time default '08:00',
  saturday_end time default '12:00',
  allow_personal_templates boolean not null default false,
  updated_at timestamptz not null default now(),
  check (weekday_end > weekday_start),
  check ((saturday_start is null) = (saturday_end is null)),
  check (saturday_end is null or saturday_end > saturday_start)
);

create table public.followup_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  trigger public.followup_trigger not null,
  stage_id uuid,
  loss_reasons public.loss_reason[] not null default '{}',
  stop_stage_id uuid,
  edit_level public.edit_level not null default 'ajustable',
  -- null = plantilla de la agencia; con valor = plantilla personal de ese asesor.
  owner_id uuid,
  active boolean not null default true,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  foreign key (agency_id, stage_id) references public.pipeline_stages (agency_id, id),
  foreign key (agency_id, stop_stage_id) references public.pipeline_stages (agency_id, id),
  check ((trigger = 'etapa') = (stage_id is not null)),
  check (trigger = 'perdida' or loss_reasons = '{}')
);
create index followup_templates_agency_idx on public.followup_templates (agency_id, trigger) where active;

create table public.followup_steps (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  template_id uuid not null,
  position integer not null check (position >= 0),
  kind public.task_kind not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  -- Topes por unidad: un año en minutos, 2000 horas hábiles, 500 días hábiles, 730 días.
  delay_amount integer not null default 0 check (delay_amount >= 0),
  delay_unit public.delay_unit not null default 'minutos',
  at_time time,
  priority public.priority not null default 'media',
  message text check (message is null or length(message) <= 1000),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (agency_id, id),
  foreign key (agency_id, template_id) references public.followup_templates (agency_id, id) on delete cascade,
  check (at_time is null or delay_unit in ('dias_habiles', 'dias')),
  check (delay_amount <= case delay_unit when 'minutos' then 525600 when 'horas_habiles' then 2000
                                         when 'dias_habiles' then 500 else 730 end)
);
create index followup_steps_template_idx on public.followup_steps (template_id, position);

alter table public.tasks
  add column template_id uuid,
  add column step_id uuid references public.followup_steps (id) on delete set null,
  add column trigger_stage_id uuid,
  add column message text check (message is null or length(message) <= 1000),
  add column edit_level public.edit_level,
  add foreign key (agency_id, template_id) references public.followup_templates (agency_id, id),
  add foreign key (agency_id, trigger_stage_id) references public.pipeline_stages (agency_id, id);
create index tasks_followup_idx on public.tasks (opportunity_id, status) where template_id is not null;

-- ¿La agencia permite plantillas personales?
create function app.personal_templates_allowed(p_agency uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.allow_personal_templates from public.agency_settings s where s.agency_id = p_agency), false);
$$;

-- Quién puede ver y escribir una plantilla (RF-220, RF-227, RF-228).
create function app.template_visible(p_agency uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_member(p_agency)
    and (p_owner is null or p_owner = auth.uid() or app.has_role(p_agency, array['admin']::public.agency_role[]));
$$;

create function app.template_writable(p_agency uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role(p_agency, array['admin']::public.agency_role[])
    or (p_owner = auth.uid()
        and app.has_role(p_agency, array['asesor']::public.agency_role[])
        and app.personal_templates_allowed(p_agency));
$$;

create function app.step_template_writable(p_template uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.followup_templates t where t.id = p_template and app.template_writable(t.agency_id, t.owner_id));
$$;

create function app.step_template_visible(p_template uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.followup_templates t where t.id = p_template and app.template_visible(t.agency_id, t.owner_id));
$$;

create function app.followup_templates_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.assert_active_member(new.agency_id, new.owner_id);
  new.updated_at := now();
  return new;
end;
$$;
create trigger followup_templates_rules before insert or update on public.followup_templates
  for each row execute function app.followup_templates_rules();

-- ---------------------------------------------------------------------------------------------
-- Cálculo de fechas dentro del horario laboral (RF-223). Todo en hora local de la agencia.

-- Primer instante laborable igual o posterior a p_ts.
create function app.next_open(p_ts timestamp, s public.agency_settings) returns timestamp
language plpgsql immutable set search_path = ''
as $$
declare
  d date;
  ws time;
  we time;
begin
  for i in 0..14 loop
    d := p_ts::date + i;
    case extract(isodow from d)::int
      when 6 then ws := s.saturday_start; we := s.saturday_end;
      when 7 then ws := null; we := null;
      else ws := s.weekday_start; we := s.weekday_end;
    end case;
    continue when ws is null;
    if i > 0 or p_ts::time < ws then
      return d + ws;
    elsif p_ts::time < we then
      return p_ts;
    end if;
  end loop;
  return p_ts;
end;
$$;

create function app.day_end(p_day date, s public.agency_settings) returns time
language sql immutable set search_path = ''
as $$
  select case extract(isodow from p_day)::int when 6 then s.saturday_end when 7 then null else s.weekday_end end;
$$;

create function app.followup_due(p_from timestamptz, p_amount integer, p_unit public.delay_unit, p_at time, p_agency uuid)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.agency_settings;
  v_local timestamp;
  v_cur timestamp;
  v_rem numeric;
  v_avail numeric;
  v_day date;
  v_res timestamp;
begin
  select * into s from public.agency_settings where agency_id = p_agency;
  if not found then
    s.agency_id := p_agency;
    s.time_zone := 'America/Bogota';
    s.weekday_start := '08:00'; s.weekday_end := '18:00';
    s.saturday_start := '08:00'; s.saturday_end := '12:00';
  end if;
  v_local := p_from at time zone s.time_zone;

  if p_unit = 'minutos' then
    v_res := app.next_open(v_local + make_interval(mins => p_amount), s);
  elsif p_unit = 'horas_habiles' then
    v_cur := app.next_open(v_local, s);
    v_rem := p_amount * 60;
    for i in 1..5000 loop
      v_avail := extract(epoch from ((v_cur::date + app.day_end(v_cur::date, s)) - v_cur)) / 60;
      if v_rem <= v_avail then
        v_res := v_cur + make_interval(mins => v_rem::int);
        exit;
      end if;
      v_rem := v_rem - v_avail;
      v_cur := app.next_open((v_cur::date + 1)::timestamp, s);
    end loop;
  else
    v_day := v_local::date;
    if p_unit = 'dias' then
      v_day := v_day + p_amount;
    else
      for i in 1..p_amount loop
        v_day := (app.next_open((v_day + 1)::timestamp, s))::date;
      end loop;
    end if;
    v_res := app.next_open(greatest(v_day + coalesce(p_at, v_local::time), v_local), s);
  end if;
  -- Nunca vacío: si algo no cuadra, el primer instante laborable.
  return coalesce(v_res, app.next_open(v_local, s)) at time zone s.time_zone;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Motor: crea y cancela tareas al crear o mover oportunidades (RF-221 a RF-225).

create function app.followups_on_opportunity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_stage public.pipeline_stages%rowtype;
  v_count integer;
  v_tpl record;
  v_step record;
  v_created integer;
  v_assignee uuid;
begin
  -- Cambio de responsable: las tareas automáticas abiertas del anterior pasan al nuevo.
  if tg_op = 'UPDATE' and new.owner_id is not null and new.owner_id is distinct from old.owner_id then
    update public.tasks t set assignee_id = new.owner_id
    where t.opportunity_id = new.id and t.status = 'abierta' and t.template_id is not null
      and (old.owner_id is null or t.assignee_id = old.owner_id);
  end if;

  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  select * into v_stage from public.pipeline_stages where id = new.stage_id;
  -- El responsable, o quien hizo el cambio si el responsable ya no es miembro activo.
  v_assignee := case when exists (
      select 1 from public.memberships m
      where m.agency_id = new.agency_id and m.user_id = new.owner_id and m.revoked_at is null)
    then new.owner_id else v_actor end;

  -- Cancelación: llegó a la etapa de parada (o posterior), se cerró, o salió de la etapa cerrada que la disparó.
  if tg_op = 'UPDATE' then
    with gone as (
      update public.tasks t
      set status = 'cancelada', result = 'Cancelada automáticamente: la oportunidad pasó a ' || v_stage.name
      from public.followup_templates ft, public.pipeline_stages trig
      where t.opportunity_id = new.id and t.status = 'abierta' and t.template_id = ft.id
        and trig.id = t.trigger_stage_id and t.trigger_stage_id is distinct from new.stage_id
        and (
          v_stage.kind <> 'abierta'
          or trig.kind <> 'abierta'
          or exists (select 1 from public.pipeline_stages stop where stop.id = ft.stop_stage_id and v_stage.position >= stop.position)
        )
      returning t.id
    )
    select count(*) into v_count from gone;
    if v_count > 0 then
      insert into public.activities (agency_id, contact_id, opportunity_id, kind, data, actor_id)
      values (new.agency_id, new.contact_id, new.id, 'seguimiento.cancelado',
              jsonb_build_object('cantidad', v_count, 'etapa', v_stage.name), v_actor);
    end if;
  end if;

  -- Creación: plantillas activas de la agencia y las personales del responsable.
  for v_tpl in
    select ft.* from public.followup_templates ft
    where ft.agency_id = new.agency_id and ft.active
      and (ft.owner_id is null or (ft.owner_id = new.owner_id and app.personal_templates_allowed(new.agency_id)))
      and (
        (ft.trigger = 'creada' and tg_op = 'INSERT')
        or (ft.trigger = 'etapa' and ft.stage_id = new.stage_id)
        or (ft.trigger = 'ganada' and v_stage.kind = 'ganada')
        or (ft.trigger = 'perdida' and v_stage.kind = 'perdida'
            and (ft.loss_reasons = '{}' or new.lost_reason = any (ft.loss_reasons)))
      )
      -- No empieza una secuencia que ya llegó a su etapa de parada.
      and not (v_stage.kind = 'abierta' and exists (
        select 1 from public.pipeline_stages stop where stop.id = ft.stop_stage_id and v_stage.position >= stop.position))
    order by ft.created_at
  loop
    v_created := 0;
    for v_step in
      select st.* from public.followup_steps st where st.template_id = v_tpl.id order by st.position, st.created_at
    loop
      continue when exists (
        select 1 from public.tasks x where x.opportunity_id = new.id and x.step_id = v_step.id and x.status = 'abierta');
      insert into public.tasks (agency_id, contact_id, opportunity_id, kind, title, assignee_id, due_at, priority,
                                created_by, template_id, step_id, trigger_stage_id, message, edit_level)
      values (new.agency_id, new.contact_id, new.id, v_step.kind, v_step.title, v_assignee,
              app.followup_due(now(), v_step.delay_amount, v_step.delay_unit, v_step.at_time, new.agency_id),
              v_step.priority, v_actor, v_tpl.id, v_step.id, new.stage_id, v_step.message,
              case when v_step.locked then 'bloqueada'::public.edit_level else v_tpl.edit_level end);
      v_created := v_created + 1;
    end loop;
    if v_created > 0 then
      insert into public.activities (agency_id, contact_id, opportunity_id, kind, data, actor_id)
      values (new.agency_id, new.contact_id, new.id, 'seguimiento.creado',
              jsonb_build_object('plantilla', v_tpl.name, 'cantidad', v_created), v_actor);
      insert into public.audit_events (agency_id, actor_id, action, object_type, object_id, changes)
      values (new.agency_id, v_actor, 'followup.applied', 'opportunity', new.id::text,
              jsonb_build_object('template', v_tpl.id, 'tasks', v_created));
    end if;
  end loop;
  return null;
end;
$$;
create trigger opportunities_followups after insert or update on public.opportunities
  for each row execute function app.followups_on_opportunity();

-- Nivel de edición (RF-226). Se ejecuta con los privilegios de quien llama: si la llamada viene
-- del motor (security definer), current_user no es "authenticated" y el cambio se permite.
create function app.tasks_edit_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_level public.edit_level := coalesce(old.edit_level, 'libre');
begin
  if current_user <> 'authenticated' or v_level = 'libre'
     or app.has_role(old.agency_id, array['admin']::public.agency_role[]) then
    return new;
  end if;
  if (new.status = 'cancelada' and old.status <> 'cancelada')
     or (old.status <> 'abierta' and new.status is distinct from old.status)
     or (old.status = 'abierta' and new.status = 'abierta' and new.result is distinct from old.result)
     or new.kind is distinct from old.kind
     or new.title is distinct from old.title
     or new.assignee_id is distinct from old.assignee_id
     or (v_level = 'bloqueada' and (new.due_at is distinct from old.due_at
                                     or new.priority is distinct from old.priority
                                     or new.message is distinct from old.message)) then
    raise exception 'task_locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger tasks_edit_guard before update on public.tasks
  for each row execute function app.tasks_edit_guard();

-- RLS
alter table public.agency_settings enable row level security;
alter table public.followup_templates enable row level security;
alter table public.followup_steps enable row level security;

create policy settings_select on public.agency_settings for select to authenticated using (app.is_member(agency_id));
create policy settings_insert on public.agency_settings for insert to authenticated
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]));
create policy settings_update on public.agency_settings for update to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]));

create policy templates_select on public.followup_templates for select to authenticated
  using (app.template_visible(agency_id, owner_id));
create policy templates_insert on public.followup_templates for insert to authenticated
  with check (app.template_writable(agency_id, owner_id) and created_by = auth.uid());
create policy templates_update on public.followup_templates for update to authenticated
  using (app.template_writable(agency_id, owner_id))
  with check (app.template_writable(agency_id, owner_id));

create policy steps_select on public.followup_steps for select to authenticated using (app.step_template_visible(template_id));
create policy steps_insert on public.followup_steps for insert to authenticated with check (app.step_template_writable(template_id));
create policy steps_update on public.followup_steps for update to authenticated
  using (app.step_template_writable(template_id)) with check (app.step_template_writable(template_id));
create policy steps_delete on public.followup_steps for delete to authenticated using (app.step_template_writable(template_id));

revoke all on public.agency_settings, public.followup_templates, public.followup_steps from anon, authenticated;
grant select, insert on public.agency_settings to authenticated;
grant update (weekday_start, weekday_end, saturday_start, saturday_end, allow_personal_templates, updated_at)
  on public.agency_settings to authenticated;
grant select, insert on public.followup_templates to authenticated;
grant update (name, trigger, stage_id, loss_reasons, stop_stage_id, edit_level, active) on public.followup_templates to authenticated;
grant select, insert, delete on public.followup_steps to authenticated;
grant update (position, kind, title, delay_amount, delay_unit, at_time, priority, message, locked) on public.followup_steps to authenticated;
grant update (message) on public.tasks to authenticated;
revoke all on all functions in schema app from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.agency_role[]) to authenticated;
grant execute on function app.template_visible(uuid, uuid), app.template_writable(uuid, uuid),
  app.step_template_visible(uuid), app.step_template_writable(uuid), app.personal_templates_allowed(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Plantillas precargadas para agencia de viajes (RF-229). Cada agencia las ajusta o apaga.

create function app.seed_followups(p_agency uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tpl uuid;
  v_stage uuid;
  v_stop uuid;
begin
  insert into public.agency_settings (agency_id) values (p_agency) on conflict do nothing;
  if exists (select 1 from public.followup_templates where agency_id = p_agency) then
    return;
  end if;

  -- 1. Oportunidad nueva: contacto rápido.
  select id into v_stop from public.pipeline_stages where agency_id = p_agency and name = 'Contactado';
  insert into public.followup_templates (agency_id, name, trigger, stop_stage_id, created_by)
  values (p_agency, 'Oportunidad nueva: contacto rápido', 'creada', v_stop, p_actor) returning id into v_tpl;
  insert into public.followup_steps (agency_id, template_id, position, kind, title, delay_amount, delay_unit, at_time, priority, message) values
    (p_agency, v_tpl, 0, 'whatsapp', 'Saludo de recibido por WhatsApp', 15, 'minutos', null, 'alta',
     'Hola {nombre}, recibimos tu solicitud de viaje a {destino}. Te escribo de {agencia} para ayudarte. ¿Tienes un momento para hablar?'),
    (p_agency, v_tpl, 1, 'llamada', 'Llamada de calificación: fechas, viajeros, presupuesto, pasaporte y visa', 1, 'horas_habiles', null, 'alta', null),
    (p_agency, v_tpl, 2, 'whatsapp', 'Segundo intento de contacto', 1, 'dias_habiles', null, 'media',
     'Hola {nombre}, te escribí sobre tu viaje a {destino}. ¿A qué hora te puedo llamar?'),
    (p_agency, v_tpl, 3, 'correo', 'Último intento: seguimos atentos', 3, 'dias_habiles', null, 'media',
     'Hola {nombre}, seguimos atentos a tu viaje a {destino}. Responde este correo o escríbenos por WhatsApp cuando quieras retomarlo. Equipo de {agencia}.');

  -- 2. Calificado: preparar propuesta.
  select id into v_stage from public.pipeline_stages where agency_id = p_agency and name = 'Calificado';
  select id into v_stop from public.pipeline_stages where agency_id = p_agency and name = 'Propuesta enviada';
  if v_stage is not null then
    insert into public.followup_templates (agency_id, name, trigger, stage_id, stop_stage_id, created_by)
    values (p_agency, 'Calificado: preparar propuesta', 'etapa', v_stage, v_stop, p_actor) returning id into v_tpl;
    insert into public.followup_steps (agency_id, template_id, position, kind, title, delay_amount, delay_unit, at_time, priority, message) values
      (p_agency, v_tpl, 0, 'tarea', 'Consultar disponibilidad y tarifas con proveedores', 0, 'dias_habiles', null, 'alta', null),
      (p_agency, v_tpl, 1, 'tarea', 'Enviar la cotización al cliente', 1, 'dias_habiles', null, 'alta', null);
  end if;

  -- 3. Propuesta enviada: seguimiento.
  select id into v_stage from public.pipeline_stages where agency_id = p_agency and name = 'Propuesta enviada';
  select id into v_stop from public.pipeline_stages where agency_id = p_agency and name = 'Negociación';
  if v_stage is not null then
    insert into public.followup_templates (agency_id, name, trigger, stage_id, stop_stage_id, created_by)
    values (p_agency, 'Propuesta enviada: seguimiento', 'etapa', v_stage, v_stop, p_actor) returning id into v_tpl;
    insert into public.followup_steps (agency_id, template_id, position, kind, title, delay_amount, delay_unit, at_time, priority, message) values
      (p_agency, v_tpl, 0, 'whatsapp', 'Confirmar que revisó la propuesta', 1, 'dias_habiles', '10:00', 'media',
       'Hola {nombre}, ¿pudiste revisar la propuesta de tu viaje a {destino}? Si tienes dudas, te las resuelvo.'),
      (p_agency, v_tpl, 1, 'llamada', 'Resolver dudas y ofrecer alternativas', 3, 'dias_habiles', '10:00', 'media', null),
      (p_agency, v_tpl, 2, 'whatsapp', 'Aviso de vigencia de tarifas y cupos', 5, 'dias_habiles', '10:00', 'media',
       'Hola {nombre}, te cuento que las tarifas y los cupos de tu viaje a {destino} pueden cambiar. Si quieres asegurar el precio, te ayudo a reservar.');
  end if;

  -- 4. Negociación: cierre.
  select id into v_stage from public.pipeline_stages where agency_id = p_agency and name = 'Negociación';
  if v_stage is not null then
    insert into public.followup_templates (agency_id, name, trigger, stage_id, created_by)
    values (p_agency, 'Negociación: cierre', 'etapa', v_stage, p_actor) returning id into v_tpl;
    insert into public.followup_steps (agency_id, template_id, position, kind, title, delay_amount, delay_unit, at_time, priority, message) values
      (p_agency, v_tpl, 0, 'llamada', 'Confirmar la opción elegida y la forma de pago', 2, 'dias_habiles', '10:00', 'alta', null);
  end if;

  -- 5. Ganado: bienvenida y documentos.
  insert into public.followup_templates (agency_id, name, trigger, created_by)
  values (p_agency, 'Ganado: bienvenida y documentos', 'ganada', p_actor) returning id into v_tpl;
  insert into public.followup_steps (agency_id, template_id, position, kind, title, delay_amount, delay_unit, at_time, priority, message) values
    (p_agency, v_tpl, 0, 'whatsapp', 'Agradecer y pedir los datos de los viajeros', 0, 'minutos', null, 'alta',
     'Hola {nombre}, ¡gracias por viajar con {agencia}! Para avanzar con tu viaje a {destino}, envíame el nombre completo de cada viajero como aparece en el pasaporte y su fecha de nacimiento.'),
    (p_agency, v_tpl, 1, 'tarea', 'Verificar requisitos: pasaporte con 6 meses de vigencia, visas, vacunas y seguro', 1, 'dias_habiles', null, 'alta', null);

  -- 6. Perdido: reactivar más adelante.
  insert into public.followup_templates (agency_id, name, trigger, loss_reasons, created_by)
  values (p_agency, 'Perdido: reactivar más adelante', 'perdida', array['sin_respuesta', 'cambio_de_planes']::public.loss_reason[], p_actor)
  returning id into v_tpl;
  insert into public.followup_steps (agency_id, template_id, position, kind, title, delay_amount, delay_unit, at_time, priority, message) values
    (p_agency, v_tpl, 0, 'whatsapp', 'Retomar el contacto con una idea de viaje', 90, 'dias', '10:00', 'baja',
     'Hola {nombre}, hace un tiempo hablamos de tu viaje a {destino}. ¿Sigues pensando en viajar? Tenemos opciones nuevas que te pueden gustar.');
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
  insert into public.audit_events (agency_id, actor_id, action, object_type, object_id, changes)
    values (v_id, v_uid, 'agency.created', 'agency', v_id::text, jsonb_build_object('name', btrim(p_name), 'slug', p_slug));
  return v_id;
end;
$$;
revoke all on function public.create_agency(text, text) from public, anon;
grant execute on function public.create_agency(text, text) to authenticated;

-- Agencias que ya existían antes de esta migración (no toca sus tareas ni oportunidades).
select app.seed_followups(a.id, a.created_by) from public.agencies a;
